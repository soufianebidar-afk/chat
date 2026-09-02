<?php
if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

/**
 * Prevents repeated extension retries from creating duplicate temporary media
 * and removes abandoned temporary attachments after a safety delay.
 */
final class CDH_Temp_Media_Guard {
    const FINGERPRINT_META = '_cdh_import_media_fingerprint_v1';
    const CREATED_AT_META  = '_cdh_temp_media_created_at';
    const CLEANUP_HOOK     = 'cdh_cleanup_temp_import_media';
    const CLEANUP_TTL      = DAY_IN_SECONDS;
    const CLEANUP_BATCH    = 100;

    private static $routes = array(
        '/cdh/v1/import-media'    => 'image',
        '/cdh/v1/import-video'    => 'video',
        '/cdh/v1/import-document' => 'document',
    );

    public static function init() {
        add_filter( 'rest_pre_dispatch', array( __CLASS__, 'reuse_existing_media' ), 9, 3 );
        add_filter( 'rest_post_dispatch', array( __CLASS__, 'remember_media_fingerprint' ), 10, 3 );
        add_action( 'init', array( __CLASS__, 'schedule_cleanup' ) );
        add_action( self::CLEANUP_HOOK, array( __CLASS__, 'cleanup_abandoned_media' ) );
    }

    public static function schedule_cleanup() {
        if ( ! wp_next_scheduled( self::CLEANUP_HOOK ) ) {
            wp_schedule_event( time() + HOUR_IN_SECONDS, 'hourly', self::CLEANUP_HOOK );
        }
    }

    private static function fingerprint_for_request( WP_REST_Request $request ) {
        $route = (string) $request->get_route();
        $kind  = self::$routes[ $route ] ?? '';
        if ( ! $kind ) {
            return '';
        }

        $payload = $request->get_json_params();
        if ( ! is_array( $payload ) ) {
            $payload = array();
        }

        if ( 'image' === $kind ) {
            $data_url = trim( (string) ( $payload['data_url'] ?? '' ) );
            if ( '' === $data_url ) {
                return '';
            }
            return 'image:' . hash( 'sha256', $data_url );
        }

        $source_url = esc_url_raw( (string) ( $payload['source_url'] ?? '' ), array( 'https' ) );
        if ( '' === $source_url ) {
            return '';
        }

        if ( 'document' === $kind ) {
            $type = sanitize_key( (string) ( $payload['type'] ?? 'other' ) );
            return 'document:' . hash( 'sha256', $type . "\n" . $source_url );
        }

        return 'video:' . hash( 'sha256', $source_url );
    }

    private static function existing_attachment_id( $fingerprint ) {
        if ( '' === $fingerprint ) {
            return 0;
        }

        $ids = get_posts( array(
            'post_type'              => 'attachment',
            'post_status'            => 'inherit',
            'posts_per_page'         => 1,
            'fields'                 => 'ids',
            'orderby'                => 'ID',
            'order'                  => 'DESC',
            'no_found_rows'          => true,
            'suppress_filters'       => false,
            'update_post_meta_cache' => false,
            'update_post_term_cache' => false,
            'meta_key'               => self::FINGERPRINT_META,
            'meta_value'             => $fingerprint,
        ) );

        $attachment_id = $ids ? absint( $ids[0] ) : 0;
        if ( ! $attachment_id || 'attachment' !== get_post_type( $attachment_id ) ) {
            return 0;
        }
        if ( ! wp_get_attachment_url( $attachment_id ) ) {
            return 0;
        }
        return $attachment_id;
    }

    private static function response_for_attachment( $attachment_id ) {
        $path = (string) get_attached_file( $attachment_id );
        return new WP_REST_Response( array(
            'media_id' => (int) $attachment_id,
            'url'      => esc_url_raw( (string) wp_get_attachment_url( $attachment_id ), array( 'https' ) ),
            'mime'     => (string) get_post_mime_type( $attachment_id ),
            'filename' => $path ? basename( $path ) : '',
            'reused'   => true,
        ), 201 );
    }

    public static function reuse_existing_media( $result, WP_REST_Server $server, WP_REST_Request $request ) {
        if ( null !== $result ) {
            return $result;
        }
        if ( ! isset( self::$routes[ (string) $request->get_route() ] ) ) {
            return $result;
        }

        $fingerprint = self::fingerprint_for_request( $request );
        $attachment_id = self::existing_attachment_id( $fingerprint );
        if ( ! $attachment_id ) {
            return $result;
        }

        return self::response_for_attachment( $attachment_id );
    }

    public static function remember_media_fingerprint( $response, WP_REST_Server $server, WP_REST_Request $request ) {
        if ( ! isset( self::$routes[ (string) $request->get_route() ] ) ) {
            return $response;
        }
        if ( ! $response instanceof WP_REST_Response || 201 !== $response->get_status() ) {
            return $response;
        }

        $data = $response->get_data();
        $attachment_id = absint( is_array( $data ) ? ( $data['media_id'] ?? 0 ) : 0 );
        $fingerprint   = self::fingerprint_for_request( $request );
        if ( $attachment_id && $fingerprint && 'attachment' === get_post_type( $attachment_id ) ) {
            update_post_meta( $attachment_id, self::FINGERPRINT_META, $fingerprint );
        }
        return $response;
    }

    public static function cleanup_abandoned_media() {
        $cutoff = time() - self::CLEANUP_TTL;
        $ids = get_posts( array(
            'post_type'              => 'attachment',
            'post_status'            => 'inherit',
            'post_parent'            => 0,
            'posts_per_page'         => self::CLEANUP_BATCH,
            'fields'                 => 'ids',
            'orderby'                => 'ID',
            'order'                  => 'ASC',
            'no_found_rows'          => true,
            'suppress_filters'       => false,
            'update_post_meta_cache' => true,
            'update_post_term_cache' => false,
            'meta_query'             => array(
                array(
                    'key'     => self::CREATED_AT_META,
                    'value'   => $cutoff,
                    'compare' => '<',
                    'type'    => 'NUMERIC',
                ),
            ),
        ) );

        foreach ( (array) $ids as $attachment_id ) {
            $attachment_id = absint( $attachment_id );
            if ( ! $attachment_id || 0 !== (int) wp_get_post_parent_id( $attachment_id ) ) {
                continue;
            }
            $temporary = '1' === (string) get_post_meta( $attachment_id, '_cdh_temp_import_media', true )
                || '1' === (string) get_post_meta( $attachment_id, '_cdh_temp_import_video', true )
                || '1' === (string) get_post_meta( $attachment_id, '_cdh_temp_import_document', true );
            if ( $temporary ) {
                wp_delete_attachment( $attachment_id, true );
            }
        }
    }
}
