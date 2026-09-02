<?php
if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

final class CDH_REST_API {
    const OPTION_KEY_HASH = 'cdh_api_key_hash_v1';
    const KEY_NOTICE_PREFIX = 'cdh_api_key_plain_';
    const IMPORT_LOCK_PREFIX = 'cdh_import_lock_v1_';
    const IMPORT_LOCK_TTL = 300;

    public static function init() {
        add_action( 'rest_api_init', array( __CLASS__, 'register_routes' ) );
        add_action( 'admin_post_cdh_rotate_api_key', array( __CLASS__, 'rotate_api_key' ) );
    }

    public static function register_routes() {
        register_rest_route(
            'cdh/v1',
            '/categories',
            array(
                'methods'             => WP_REST_Server::READABLE,
                'callback'            => array( __CLASS__, 'get_categories' ),
                'permission_callback' => array( __CLASS__, 'api_permission' ),
            )
        );

        register_rest_route(
            'cdh/v1',
            '/config',
            array(
                'methods'             => WP_REST_Server::READABLE,
                'callback'            => array( __CLASS__, 'get_config' ),
                'permission_callback' => array( __CLASS__, 'api_permission' ),
            )
        );

        register_rest_route(
            'cdh/v1',
            '/catalog/mappings',
            array(
                'methods'             => WP_REST_Server::CREATABLE,
                'callback'            => array( __CLASS__, 'save_attribute_mapping' ),
                'permission_callback' => array( __CLASS__, 'api_permission' ),
            )
        );

        register_rest_route(
            'cdh/v1',
            '/products/lookup',
            array(
                'methods'             => WP_REST_Server::READABLE,
                'callback'            => array( __CLASS__, 'lookup_product' ),
                'permission_callback' => array( __CLASS__, 'api_permission' ),
                'args'                => array(
                    'supplier_key' => array(
                        'required'          => false,
                        'sanitize_callback' => 'sanitize_key',
                        'default'           => 'aliexpress',
                    ),
                    'supplier_product_id' => array(
                        'required'          => true,
                        'sanitize_callback' => 'sanitize_text_field',
                    ),
                ),
            )
        );

        register_rest_route(
            'cdh/v1',
            '/import-media',
            array(
                'methods'             => WP_REST_Server::CREATABLE,
                'callback'            => array( __CLASS__, 'import_media' ),
                'permission_callback' => array( __CLASS__, 'api_permission' ),
            )
        );

        register_rest_route(
            'cdh/v1',
            '/import-video',
            array(
                'methods'             => WP_REST_Server::CREATABLE,
                'callback'            => array( __CLASS__, 'import_video' ),
                'permission_callback' => array( __CLASS__, 'api_permission' ),
            )
        );

        register_rest_route(
            'cdh/v1',
            '/import-document',
            array(
                'methods'             => WP_REST_Server::CREATABLE,
                'callback'            => array( __CLASS__, 'import_document' ),
                'permission_callback' => array( __CLASS__, 'api_permission' ),
            )
        );

        register_rest_route(
            'cdh/v1',
            '/import',
            array(
                'methods'             => WP_REST_Server::CREATABLE,
                'callback'            => array( __CLASS__, 'import_product' ),
                'permission_callback' => array( __CLASS__, 'api_permission' ),
            )
        );
    }

    private static function hash_key( $plain ) {
        return hash_hmac( 'sha256', (string) $plain, wp_salt( 'auth' ) );
    }

    public static function api_permission( WP_REST_Request $request ) {
        $stored = (string) get_option( self::OPTION_KEY_HASH, '' );
        $plain  = trim( (string) $request->get_header( 'X-CDH-Api-Key' ) );
        if ( '' === $stored || '' === $plain ) {
            return new WP_Error( 'cdh_unauthorized', __( 'Clé API CDH manquante ou non configurée.', 'constello-dropship-hub' ), array( 'status' => 401 ) );
        }
        if ( ! hash_equals( $stored, self::hash_key( $plain ) ) ) {
            return new WP_Error( 'cdh_unauthorized', __( 'Clé API CDH invalide.', 'constello-dropship-hub' ), array( 'status' => 401 ) );
        }
        return true;
    }

    public static function rotate_api_key() {
        if ( ! current_user_can( 'manage_woocommerce' ) ) {
            wp_die( esc_html__( 'Accès refusé.', 'constello-dropship-hub' ) );
        }
        check_admin_referer( 'cdh_rotate_api_key' );

        $plain = wp_generate_password( 48, false, false );
        update_option( self::OPTION_KEY_HASH, self::hash_key( $plain ), false );
        set_transient( self::KEY_NOTICE_PREFIX . get_current_user_id(), $plain, 10 * MINUTE_IN_SECONDS );

        wp_safe_redirect( add_query_arg( array( 'page' => CDH_Admin_Shell::ROUTE_SETTINGS, 'cdh_key_rotated' => '1' ), admin_url( 'admin.php' ) ) );
        exit;
    }

    public static function get_categories() {
        if ( ! taxonomy_exists( 'product_cat' ) ) {
            return new WP_Error( 'cdh_woocommerce_unavailable', __( 'Les catégories WooCommerce ne sont pas disponibles.', 'constello-dropship-hub' ), array( 'status' => 503 ) );
        }

        $terms = get_terms( array( 'taxonomy' => 'product_cat', 'hide_empty' => false ) );
        if ( is_wp_error( $terms ) ) {
            return $terms;
        }

        return rest_ensure_response( array(
            'categories' => array_map( static function ( $term ) {
                return array(
                    'id'     => (int) $term->term_id,
                    'name'   => (string) $term->name,
                    'slug'   => (string) $term->slug,
                    'parent' => (int) $term->parent,
                );
            }, $terms ),
        ) );
    }

    public static function get_config() {
        $currency = function_exists( 'get_woocommerce_currency' ) ? get_woocommerce_currency() : '';
        $catalog = class_exists( 'CDH_Catalog_Settings' ) ? CDH_Catalog_Settings::public_config() : array();
        return rest_ensure_response( array_merge( array(
            'site_name'       => get_bloginfo( 'name' ),
            'site_url'        => home_url( '/' ),
            'currency'        => $currency,
            'currency_symbol' => function_exists( 'get_woocommerce_currency_symbol' ) ? get_woocommerce_currency_symbol( $currency ) : $currency,
            'price_decimals'  => function_exists( 'wc_get_price_decimals' ) ? wc_get_price_decimals() : 2,
            'pricing'         => class_exists( 'CDH_Pricing_Rules' ) ? CDH_Pricing_Rules::public_summary() : array( 'configured' => false ),
        ), $catalog ) );
    }

    public static function save_attribute_mapping( WP_REST_Request $request ) {
        if ( ! class_exists( 'CDH_Catalog_Settings' ) ) return new WP_Error( 'cdh_catalog_unavailable', __( 'Configuration catalogue indisponible.', 'constello-dropship-hub' ), array( 'status' => 503 ) );
        $saved = CDH_Catalog_Settings::save_mapping( $request->get_json_params() );
        if ( is_wp_error( $saved ) ) return $saved;
        return rest_ensure_response( array( 'ok' => true, 'mapping' => $saved ) );
    }

    /**
     * Retourne l'état WooCommerce d'un produit fournisseur sans jamais conclure
     * « non importé » sur une erreur réseau côté extension. L'identité métier est
     * strictement supplier_key + supplier_product_id, jamais le titre.
     */
    public static function lookup_product( WP_REST_Request $request ) {
        $supplier_key        = sanitize_key( (string) $request->get_param( 'supplier_key' ) );
        $supplier_product_id = sanitize_text_field( (string) $request->get_param( 'supplier_product_id' ) );

        if ( '' === $supplier_key ) {
            $supplier_key = 'aliexpress';
        }
        if ( '' === $supplier_product_id ) {
            return new WP_Error(
                'cdh_missing_supplier_product_id',
                __( 'Identifiant produit fournisseur manquant.', 'constello-dropship-hub' ),
                array( 'status' => 400 )
            );
        }

        $query = self::supplier_product_query( $supplier_key, $supplier_product_id, 10 );

        $ids   = array_values( array_filter( array_map( 'absint', (array) $query->posts ) ) );
        $count = (int) $query->found_posts;

        if ( 0 === $count || ! $ids ) {
            return rest_ensure_response( array(
                'found'               => false,
                'supplier_key'        => $supplier_key,
                'supplier_product_id' => $supplier_product_id,
            ) );
        }

        $products = array_map( array( __CLASS__, 'lookup_product_summary' ), $ids );
        $products = array_values( array_filter( $products ) );

        if ( $count > 1 ) {
            return rest_ensure_response( array(
                'found'               => true,
                'duplicate'           => true,
                'count'               => $count,
                'supplier_key'        => $supplier_key,
                'supplier_product_id' => $supplier_product_id,
                'products'            => $products,
                'products_url'        => admin_url( 'edit.php?post_type=product' ),
            ) );
        }

        $product = $products ? $products[0] : null;
        if ( ! $product ) {
            return new WP_Error(
                'cdh_lookup_failed',
                __( 'Le produit lié existe mais son état ne peut pas être lu.', 'constello-dropship-hub' ),
                array( 'status' => 500 )
            );
        }

        return rest_ensure_response( array(
            'found'               => true,
            'duplicate'           => false,
            'count'               => 1,
            'supplier_key'        => $supplier_key,
            'supplier_product_id' => $supplier_product_id,
            'product'             => $product,
        ) );
    }

    private static function supplier_product_query( $supplier_key, $supplier_product_id, $limit = 10 ) {
        return new WP_Query( array(
            'post_type'              => 'product',
            'post_status'            => array(
                'publish',
                'draft',
                'pending',
                'private',
                'future',
                'trash',
                CDH_Import_AliExpress_Status::STATUS,
            ),
            'posts_per_page'         => max( 1, absint( $limit ) ),
            'fields'                 => 'ids',
            'orderby'                => 'ID',
            'order'                  => 'DESC',
            'ignore_sticky_posts'    => true,
            'no_found_rows'          => false,
            'update_post_meta_cache' => true,
            'update_post_term_cache' => false,
            'meta_query'             => array(
                'relation' => 'AND',
                array( 'key' => '_cdh_supplier_key', 'value' => $supplier_key ),
                array( 'key' => '_cdh_supplier_product_id', 'value' => $supplier_product_id ),
            ),
        ) );
    }

    private static function import_identity_hash( $supplier_key, $supplier_product_id ) {
        return hash( 'sha256', (string) $supplier_key . "\n" . (string) $supplier_product_id );
    }

    private static function import_replay_response( $query, $supplier_key, $supplier_product_id ) {
        $ids   = array_values( array_filter( array_map( 'absint', (array) $query->posts ) ) );
        $count = (int) $query->found_posts;
        if ( 0 === $count || ! $ids ) {
            return null;
        }

        $products = array_values( array_filter( array_map( array( __CLASS__, 'lookup_product_summary' ), $ids ) ) );
        if ( $count > 1 ) {
            return new WP_Error(
                'cdh_duplicate_supplier_identity',
                __( 'Plusieurs produits WooCommerce utilisent cette même identité fournisseur. Corrigez les doublons avant de relancer l’import.', 'constello-dropship-hub' ),
                array(
                    'status'              => 409,
                    'count'               => $count,
                    'supplier_key'        => $supplier_key,
                    'supplier_product_id' => $supplier_product_id,
                    'products'            => $products,
                    'products_url'        => admin_url( 'edit.php?post_type=product' ),
                )
            );
        }

        $product = $products ? $products[0] : null;
        if ( ! $product ) {
            return new WP_Error( 'cdh_import_replay_failed', __( 'Le produit déjà importé ne peut pas être relu.', 'constello-dropship-hub' ), array( 'status' => 500 ) );
        }

        $import_state = (string) get_post_meta( $product['product_id'], '_cdh_import_state', true );
        if ( 'processing' === $import_state ) {
            $started_at = absint( get_post_meta( $product['product_id'], '_cdh_import_started_at', true ) );
            $is_stale = $started_at > 0 && $started_at < time() - self::IMPORT_LOCK_TTL;
            return new WP_Error(
                $is_stale ? 'cdh_incomplete_import' : 'cdh_import_in_progress',
                $is_stale
                    ? __( 'Un produit incomplet existe pour cette identité fournisseur. Ouvrez-le et corrigez-le avant de relancer l’import.', 'constello-dropship-hub' )
                    : __( 'L’import de ce produit fournisseur est déjà en cours. Réessayez dans quelques secondes.', 'constello-dropship-hub' ),
                array(
                    'status'       => 409,
                    'retryable'    => ! $is_stale,
                    'retry_after'  => $is_stale ? 0 : 2,
                    'product_id'   => (int) $product['product_id'],
                    'review_url'   => (string) $product['edit_url'],
                    'import_state' => 'processing',
                )
            );
        }

        return new WP_REST_Response( array(
            'product_id'          => (int) $product['product_id'],
            'status'              => (string) $product['status'],
            'review_url'          => (string) $product['edit_url'],
            'created'             => false,
            'idempotent_replay'   => true,
            'import_action'       => 'existing',
            'supplier_key'        => $supplier_key,
            'supplier_product_id' => $supplier_product_id,
            'product'             => $product,
            'message'             => __( 'Ce produit fournisseur était déjà importé. Le produit WooCommerce existant a été réutilisé.', 'constello-dropship-hub' ),
        ), 200 );
    }

    private static function acquire_import_lock( $supplier_key, $supplier_product_id ) {
        $option_name = self::IMPORT_LOCK_PREFIX . self::import_identity_hash( $supplier_key, $supplier_product_id );
        $token = wp_generate_uuid4();
        $value = wp_json_encode( array( 'token' => $token, 'created_at' => time() ) );
        if ( add_option( $option_name, $value, '', false ) ) {
            return array( 'option_name' => $option_name, 'token' => $token );
        }

        $existing_value = (string) get_option( $option_name, '' );
        $existing = json_decode( $existing_value, true );
        $created_at = is_array( $existing ) ? absint( $existing['created_at'] ?? 0 ) : 0;
        if ( $created_at > 0 && $created_at < time() - self::IMPORT_LOCK_TTL && (string) get_option( $option_name, '' ) === $existing_value ) {
            delete_option( $option_name );
            if ( add_option( $option_name, $value, '', false ) ) {
                return array( 'option_name' => $option_name, 'token' => $token );
            }
        }

        return new WP_Error(
            'cdh_import_in_progress',
            __( 'Un import de ce produit fournisseur est déjà en cours. Réessayez dans quelques secondes.', 'constello-dropship-hub' ),
            array( 'status' => 409, 'retryable' => true, 'retry_after' => 2 )
        );
    }

    private static function release_import_lock( $lock ) {
        if ( ! is_array( $lock ) || empty( $lock['option_name'] ) || empty( $lock['token'] ) ) {
            return;
        }
        $current = json_decode( (string) get_option( $lock['option_name'], '' ), true );
        if ( is_array( $current ) && isset( $current['token'] ) && hash_equals( (string) $current['token'], (string) $lock['token'] ) ) {
            delete_option( $lock['option_name'] );
        }
    }

    private static function lookup_product_summary( $post_id ) {
        $post = get_post( $post_id );
        if ( ! $post || 'product' !== $post->post_type ) {
            return null;
        }

        $status_object = get_post_status_object( $post->post_status );
        $status_label  = $status_object && ! empty( $status_object->label )
            ? (string) $status_object->label
            : (string) $post->post_status;

        if ( CDH_Import_AliExpress_Status::STATUS === $post->post_status ) {
            $status_label = __( 'Import AliExpress', 'constello-dropship-hub' );
        }

        $category = null;
        $terms = wp_get_post_terms( $post_id, 'product_cat', array( 'number' => 1 ) );
        if ( ! is_wp_error( $terms ) && ! empty( $terms ) ) {
            $term = $terms[0];
            $category = array(
                'id'   => (int) $term->term_id,
                'name' => (string) $term->name,
            );
        }

        $imported_at_raw = (string) get_post_meta( $post_id, '_cdh_imported_at', true );
        $imported_at = null;
        if ( '' !== $imported_at_raw ) {
            $timestamp = strtotime( $imported_at_raw . ' UTC' );
            if ( false !== $timestamp ) {
                $imported_at = gmdate( 'c', $timestamp );
            }
        }

        return array(
            'product_id'        => (int) $post_id,
            'name'              => get_the_title( $post_id ),
            'status'            => (string) $post->post_status,
            'status_label'      => $status_label,
            'edit_url'          => get_edit_post_link( $post_id, 'raw' ),
            'category'          => $category,
            'imported_at'       => $imported_at,
            'supplier_price'    => (string) get_post_meta( $post_id, '_cdh_supplier_base_price', true ),
            'supplier_currency' => (string) get_post_meta( $post_id, '_cdh_supplier_currency', true ),
        );
    }

    public static function import_media( WP_REST_Request $request ) {
        if ( ! function_exists( 'wp_upload_bits' ) ) {
            return new WP_Error( 'cdh_media_unavailable', __( 'Le module média WordPress est indisponible.', 'constello-dropship-hub' ), array( 'status' => 503 ) );
        }

        $payload = $request->get_json_params();
        if ( ! is_array( $payload ) ) {
            return new WP_Error( 'cdh_invalid_payload', __( 'Payload JSON invalide.', 'constello-dropship-hub' ), array( 'status' => 400 ) );
        }

        $data_url = (string) ( $payload['data_url'] ?? '' );
        $filename = sanitize_file_name( (string) ( $payload['filename'] ?? '' ) );
        if ( ! preg_match( '#^data:(image/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=\r\n]+)$#', $data_url, $matches ) ) {
            return new WP_Error( 'cdh_invalid_media', __( 'Image locale invalide. Formats acceptés : PNG, JPEG et WebP.', 'constello-dropship-hub' ), array( 'status' => 400 ) );
        }

        $mime = strtolower( $matches[1] );
        $bytes = base64_decode( preg_replace( '/\s+/', '', $matches[2] ), true );
        if ( false === $bytes || '' === $bytes ) {
            return new WP_Error( 'cdh_invalid_media', __( 'Impossible de décoder l’image locale.', 'constello-dropship-hub' ), array( 'status' => 400 ) );
        }
        if ( strlen( $bytes ) > 10 * 1024 * 1024 ) {
            return new WP_Error( 'cdh_media_too_large', __( 'L’image modifiée dépasse la limite de 10 Mo.', 'constello-dropship-hub' ), array( 'status' => 413 ) );
        }

        $image_info = function_exists( 'getimagesizefromstring' ) ? @getimagesizefromstring( $bytes ) : false;
        if ( false === $image_info || empty( $image_info['mime'] ) || strtolower( (string) $image_info['mime'] ) !== $mime ) {
            return new WP_Error( 'cdh_invalid_media', __( 'Le contenu envoyé n’est pas une image valide.', 'constello-dropship-hub' ), array( 'status' => 400 ) );
        }

        $extensions = array( 'image/png' => 'png', 'image/jpeg' => 'jpg', 'image/webp' => 'webp' );
        $extension  = $extensions[ $mime ];
        if ( '' === $filename ) {
            $filename = 'constello-edited-' . gmdate( 'Ymd-His' ) . '-' . wp_generate_password( 8, false, false ) . '.' . $extension;
        } elseif ( strtolower( pathinfo( $filename, PATHINFO_EXTENSION ) ) !== $extension ) {
            $filename = preg_replace( '/\.[^.]+$/', '', $filename ) . '.' . $extension;
        }

        $upload = wp_upload_bits( $filename, null, $bytes );
        if ( ! empty( $upload['error'] ) ) {
            return new WP_Error( 'cdh_media_upload_failed', sanitize_text_field( $upload['error'] ), array( 'status' => 500 ) );
        }

        require_once ABSPATH . 'wp-admin/includes/image.php';
        $attachment_id = wp_insert_attachment(
            array(
                'post_mime_type' => $mime,
                'post_title'     => sanitize_text_field( pathinfo( $filename, PATHINFO_FILENAME ) ),
                'post_content'   => '',
                'post_status'    => 'inherit',
            ),
            $upload['file'],
            0,
            true
        );
        if ( is_wp_error( $attachment_id ) ) {
            @unlink( $upload['file'] );
            return $attachment_id;
        }

        $metadata = wp_generate_attachment_metadata( $attachment_id, $upload['file'] );
        if ( is_array( $metadata ) ) {
            wp_update_attachment_metadata( $attachment_id, $metadata );
        }
        update_post_meta( $attachment_id, '_cdh_temp_import_media', '1' );
        update_post_meta( $attachment_id, '_cdh_temp_media_created_at', time() );

        return new WP_REST_Response(
            array(
                'media_id' => (int) $attachment_id,
                'url'      => esc_url_raw( $upload['url'] ),
                'width'    => isset( $image_info[0] ) ? (int) $image_info[0] : 0,
                'height'   => isset( $image_info[1] ) ? (int) $image_info[1] : 0,
                'mime'     => $mime,
            ),
            201
        );
    }


    public static function import_video( WP_REST_Request $request ) {
        $payload = $request->get_json_params();
        if ( ! is_array( $payload ) ) {
            return new WP_Error( 'cdh_invalid_payload', __( 'Payload JSON invalide.', 'constello-dropship-hub' ), array( 'status' => 400 ) );
        }
        $source_url = esc_url_raw( (string) ( $payload['source_url'] ?? '' ), array( 'https' ) );
        if ( ! $source_url || 0 !== strpos( strtolower( $source_url ), 'https://' ) || ! wp_http_validate_url( $source_url ) ) {
            return new WP_Error( 'cdh_invalid_video_url', __( 'URL vidéo HTTPS invalide.', 'constello-dropship-hub' ), array( 'status' => 400 ) );
        }
        require_once ABSPATH . 'wp-admin/includes/file.php';
        require_once ABSPATH . 'wp-admin/includes/media.php';
        require_once ABSPATH . 'wp-admin/includes/image.php';
        $tmp = download_url( $source_url, 30 );
        if ( is_wp_error( $tmp ) ) return new WP_Error( 'cdh_video_download_failed', $tmp->get_error_message(), array( 'status' => 502 ) );
        $size = @filesize( $tmp );
        if ( false !== $size && $size > 64 * 1024 * 1024 ) {
            @unlink( $tmp );
            return new WP_Error( 'cdh_video_too_large', __( 'La vidéo dépasse la limite de 64 Mo.', 'constello-dropship-hub' ), array( 'status' => 413 ) );
        }
        $url_path = (string) wp_parse_url( $source_url, PHP_URL_PATH );
        $suggested = sanitize_file_name( (string) ( $payload['filename'] ?? basename( $url_path ) ) );
        if ( '' === $suggested ) $suggested = 'constello-video-' . gmdate( 'Ymd-His' ) . '.mp4';
        $ext = strtolower( pathinfo( $suggested, PATHINFO_EXTENSION ) );
        if ( ! in_array( $ext, array( 'mp4', 'webm', 'mov', 'm4v' ), true ) ) $suggested = preg_replace( '/\.[^.]+$/', '', $suggested ) . '.mp4';
        $file_array = array( 'name' => $suggested, 'tmp_name' => $tmp );
        $attachment_id = media_handle_sideload( $file_array, 0 );
        if ( is_wp_error( $attachment_id ) ) {
            @unlink( $tmp );
            return new WP_Error( 'cdh_video_upload_failed', $attachment_id->get_error_message(), array( 'status' => 500 ) );
        }
        $mime = (string) get_post_mime_type( $attachment_id );
        if ( 0 !== strpos( strtolower( $mime ), 'video/' ) ) {
            wp_delete_attachment( $attachment_id, true );
            return new WP_Error( 'cdh_invalid_video', __( 'Le média téléchargé n’est pas une vidéo reconnue par WordPress.', 'constello-dropship-hub' ), array( 'status' => 400 ) );
        }
        update_post_meta( $attachment_id, '_cdh_temp_import_video', '1' );
        update_post_meta( $attachment_id, '_cdh_temp_media_created_at', time() );
        update_post_meta( $attachment_id, '_cdh_supplier_video_url', $source_url );
        return new WP_REST_Response( array(
            'media_id' => (int) $attachment_id,
            'url'      => esc_url_raw( (string) wp_get_attachment_url( $attachment_id ) ),
            'mime'     => $mime,
            'filename' => basename( (string) get_attached_file( $attachment_id ) ),
        ), 201 );
    }


    public static function import_document( WP_REST_Request $request ) {
        $payload = $request->get_json_params();
        if ( ! is_array( $payload ) ) return new WP_Error( 'cdh_invalid_payload', __( 'Payload JSON invalide.', 'constello-dropship-hub' ), array( 'status' => 400 ) );
        $source_url = esc_url_raw( (string) ( $payload['source_url'] ?? '' ), array( 'https' ) );
        if ( ! $source_url || 0 !== strpos( strtolower( $source_url ), 'https://' ) || ! wp_http_validate_url( $source_url ) ) return new WP_Error( 'cdh_invalid_document_url', __( 'URL document HTTPS invalide.', 'constello-dropship-hub' ), array( 'status' => 400 ) );
        $host = strtolower( (string) wp_parse_url( $source_url, PHP_URL_HOST ) );
        $trusted = preg_match( '/(^|\.)(?:aliexpress-media\.com|alicdn\.com|aliexpress\.com)$/i', $host );
        if ( ! $trusted ) return new WP_Error( 'cdh_untrusted_document_host', __( 'Le document doit provenir d’un domaine média AliExpress autorisé.', 'constello-dropship-hub' ), array( 'status' => 400 ) );
        require_once ABSPATH . 'wp-admin/includes/file.php';
        require_once ABSPATH . 'wp-admin/includes/media.php';
        require_once ABSPATH . 'wp-admin/includes/image.php';
        $tmp = download_url( $source_url, 30 );
        if ( is_wp_error( $tmp ) ) return new WP_Error( 'cdh_document_download_failed', $tmp->get_error_message(), array( 'status' => 502 ) );
        $size = @filesize( $tmp );
        if ( false !== $size && $size > 20 * 1024 * 1024 ) { @unlink( $tmp ); return new WP_Error( 'cdh_document_too_large', __( 'Le document dépasse la limite de 20 Mo.', 'constello-dropship-hub' ), array( 'status' => 413 ) ); }
        $handle = @fopen( $tmp, 'rb' ); $signature = $handle ? fread( $handle, 5 ) : ''; if ( $handle ) fclose( $handle );
        if ( '%PDF-' !== $signature ) { @unlink( $tmp ); return new WP_Error( 'cdh_invalid_document', __( 'Le fichier téléchargé n’est pas un PDF valide.', 'constello-dropship-hub' ), array( 'status' => 400 ) ); }
        $path = (string) wp_parse_url( $source_url, PHP_URL_PATH );
        $filename = sanitize_file_name( (string) ( $payload['filename'] ?? basename( $path ) ) );
        if ( '' === $filename ) $filename = 'constello-document-' . gmdate( 'Ymd-His' ) . '.pdf';
        if ( 'pdf' !== strtolower( pathinfo( $filename, PATHINFO_EXTENSION ) ) ) $filename .= '.pdf';
        $file_array = array( 'name' => $filename, 'tmp_name' => $tmp );
        $attachment_id = media_handle_sideload( $file_array, 0, sanitize_text_field( (string) ( $payload['title'] ?? '' ) ) );
        if ( is_wp_error( $attachment_id ) ) { @unlink( $tmp ); return new WP_Error( 'cdh_document_upload_failed', $attachment_id->get_error_message(), array( 'status' => 500 ) ); }
        $mime = strtolower( (string) get_post_mime_type( $attachment_id ) );
        if ( 'application/pdf' !== $mime ) { wp_delete_attachment( $attachment_id, true ); return new WP_Error( 'cdh_invalid_document_mime', __( 'Le média téléchargé n’est pas reconnu comme PDF.', 'constello-dropship-hub' ), array( 'status' => 400 ) ); }
        update_post_meta( $attachment_id, '_cdh_temp_import_document', '1' );
        update_post_meta( $attachment_id, '_cdh_temp_media_created_at', time() );
        update_post_meta( $attachment_id, '_cdh_supplier_document_url', $source_url );
        update_post_meta( $attachment_id, '_cdh_supplier_document_type', sanitize_key( (string) ( $payload['type'] ?? 'other' ) ) );
        return new WP_REST_Response( array(
            'media_id' => (int) $attachment_id,
            'url'      => esc_url_raw( (string) wp_get_attachment_url( $attachment_id ) ),
            'mime'     => $mime,
            'filename' => basename( (string) get_attached_file( $attachment_id ) ),
        ), 201 );
    }

    public static function import_product( WP_REST_Request $request ) {
        if ( ! class_exists( 'WC_Product_Simple' ) ) {
            return new WP_Error( 'cdh_woocommerce_unavailable', __( 'WooCommerce doit être actif.', 'constello-dropship-hub' ), array( 'status' => 503 ) );
        }

        $payload = $request->get_json_params();
        if ( ! is_array( $payload ) ) {
            return new WP_Error( 'cdh_invalid_payload', __( 'Payload JSON invalide.', 'constello-dropship-hub' ), array( 'status' => 400 ) );
        }

        $supplier_key = sanitize_key( (string) ( $payload['supplier_key'] ?? 'aliexpress' ) );
        if ( '' === $supplier_key ) {
            $supplier_key = 'aliexpress';
        }
        $supplier_product_id = sanitize_text_field( (string) ( $payload['supplier_product_id'] ?? '' ) );
        if ( '' === $supplier_product_id ) {
            return new WP_Error( 'cdh_missing_supplier_product_id', __( 'Identifiant produit fournisseur manquant.', 'constello-dropship-hub' ), array( 'status' => 400 ) );
        }

        // A retry must resolve before temporary media are validated: the first successful import
        // has already consumed their temporary flags, but it must remain safe to replay.
        $existing_response = self::import_replay_response(
            self::supplier_product_query( $supplier_key, $supplier_product_id, 10 ),
            $supplier_key,
            $supplier_product_id
        );
        if ( null !== $existing_response ) {
            return $existing_response;
        }

        $title  = sanitize_text_field( (string) ( $payload['title'] ?? '' ) );
        $images = isset( $payload['images'] ) && is_array( $payload['images'] ) ? array_values( $payload['images'] ) : array();
        $image_media_ids = isset( $payload['image_media_ids'] ) && is_array( $payload['image_media_ids'] ) ? array_values( $payload['image_media_ids'] ) : array();
        $price  = isset( $payload['base_price']['amount'] ) ? (float) $payload['base_price']['amount'] : 0.0;
        $input_currency = strtoupper( sanitize_text_field( (string) ( $payload['base_price']['currency'] ?? '' ) ) );
        $shop_currency  = strtoupper( (string) get_woocommerce_currency() );

        if ( '' === $title ) {
            return new WP_Error( 'cdh_missing_title', __( 'Titre manquant.', 'constello-dropship-hub' ), array( 'status' => 400 ) );
        }
        if ( $price <= 0 ) {
            return new WP_Error( 'cdh_invalid_price', __( 'Prix manquant ou invalide.', 'constello-dropship-hub' ), array( 'status' => 400 ) );
        }
        if ( '' === $input_currency || $input_currency !== $shop_currency ) {
            return new WP_Error(
                'cdh_currency_mismatch',
                sprintf( __( 'Devise fournisseur %1$s différente de la devise WooCommerce %2$s. Configure AliExpress dans la devise de la boutique puis ré-analyse la fiche.', 'constello-dropship-hub' ), $input_currency ?: '—', $shop_currency ?: '—' ),
                array( 'status' => 422, 'shop_currency' => $shop_currency, 'supplier_currency' => $input_currency )
            );
        }
        $has_image = false;
        foreach ( $images as $index => $image_value ) {
            if ( absint( $image_media_ids[ $index ] ?? 0 ) || esc_url_raw( (string) $image_value ) ) {
                $has_image = true;
                break;
            }
        }
        if ( ! $has_image ) {
            return new WP_Error( 'cdh_missing_images', __( 'Aucune image valide.', 'constello-dropship-hub' ), array( 'status' => 400 ) );
        }

        $video_payload = isset( $payload['video'] ) && is_array( $payload['video'] ) ? $payload['video'] : array();
        $video_requested = ! empty( $video_payload['import_to_wordpress'] );
        $video_media_id = absint( $video_payload['media_id'] ?? 0 );
        if ( $video_requested ) {
            $valid_video_attachment = $video_media_id && 'attachment' === get_post_type( $video_media_id ) && 0 === strpos( strtolower( (string) get_post_mime_type( $video_media_id ) ), 'video/' ) && '1' === (string) get_post_meta( $video_media_id, '_cdh_temp_import_video', true );
            if ( ! $valid_video_attachment ) return new WP_Error( 'cdh_video_media_required', __( 'La vidéo doit être importée dans la médiathèque avant la création du produit.', 'constello-dropship-hub' ), array( 'status' => 422 ) );
        }

        $documents_payload = isset( $payload['documents'] ) && is_array( $payload['documents'] ) ? array_values( $payload['documents'] ) : array();
        $validated_documents = array();
        foreach ( $documents_payload as $document ) {
            if ( ! is_array( $document ) ) continue;
            $source_url = esc_url_raw( (string) ( $document['source_url'] ?? '' ), array( 'https' ) );
            $import_requested = ! array_key_exists( 'import_to_wordpress', $document ) || ! empty( $document['import_to_wordpress'] );
            $media_id = absint( $document['media_id'] ?? 0 );
            if ( $import_requested ) {
                $valid = $media_id && 'attachment' === get_post_type( $media_id ) && 'application/pdf' === strtolower( (string) get_post_mime_type( $media_id ) ) && '1' === (string) get_post_meta( $media_id, '_cdh_temp_import_document', true );
                if ( ! $valid ) return new WP_Error( 'cdh_document_media_required', __( 'Chaque PDF sélectionné doit être importé dans la médiathèque avant la création du produit.', 'constello-dropship-hub' ), array( 'status' => 422 ) );
            }
            $validated_documents[] = array(
                'type' => sanitize_key( (string) ( $document['type'] ?? 'other' ) ),
                'title' => sanitize_text_field( (string) ( $document['title'] ?? 'Document produit' ) ),
                'source_url' => $source_url,
                'canonical_url' => esc_url_raw( (string) ( $document['canonical_url'] ?? '' ), array( 'https' ) ),
                'filename' => sanitize_file_name( (string) ( $document['filename'] ?? '' ) ),
                'mime_type' => 'application/pdf',
                'language' => sanitize_text_field( (string) ( $document['language'] ?? '' ) ),
                'import_to_wordpress' => $import_requested,
                'media_id' => $media_id,
                'url' => $media_id ? esc_url_raw( (string) wp_get_attachment_url( $media_id ), array( 'https' ) ) : '',
            );
        }

        $has_variants = self::has_valid_variants( $payload['variants'] ?? array() );
        $supplier_variations = self::sanitize_supplier_variations( $payload['supplier_variations'] ?? array(), $input_currency, $payload['supplier_sku_captured_at'] ?? '' );
        if ( is_wp_error( $supplier_variations ) ) {
            return $supplier_variations;
        }
        $shipping_current = self::sanitize_supplier_shipping( $payload['shipping_current'] ?? null, $price, $input_currency );

        // Commercial pricing is server-authoritative. The extension sends raw supplier SKU costs only.
        $variation_pricing = CDH_Pricing_Rules::build_import_pricing( $supplier_variations, $price, $has_variants, $input_currency );
        if ( is_wp_error( $variation_pricing ) ) {
            return $variation_pricing;
        }

        $import_lock = self::acquire_import_lock( $supplier_key, $supplier_product_id );
        if ( is_wp_error( $import_lock ) ) {
            $existing_response = self::import_replay_response(
                self::supplier_product_query( $supplier_key, $supplier_product_id, 10 ),
                $supplier_key,
                $supplier_product_id
            );
            return null !== $existing_response ? $existing_response : $import_lock;
        }

        // Repeat the lookup after acquiring the lock. Another request may have completed between
        // the initial lookup and this atomic reservation.
        $existing_response = self::import_replay_response(
            self::supplier_product_query( $supplier_key, $supplier_product_id, 10 ),
            $supplier_key,
            $supplier_product_id
        );
        if ( null !== $existing_response ) {
            self::release_import_lock( $import_lock );
            return $existing_response;
        }

        $post_id = wp_insert_post( array(
            'post_type'    => 'product',
            'post_status'  => CDH_Import_AliExpress_Status::STATUS,
            'post_title'   => $title,
            'post_content' => wp_kses_post( (string) ( $payload['description_html'] ?? '' ) ),
        ), true );
        if ( is_wp_error( $post_id ) ) {
            self::release_import_lock( $import_lock );
            return $post_id;
        }

        // Persist the business identity before any expensive product/media work, then release the
        // short lock. Subsequent requests now resolve to this product instead of creating another.
        $import_state_meta = update_post_meta( $post_id, '_cdh_import_state', 'processing' );
        $import_started_meta = update_post_meta( $post_id, '_cdh_import_started_at', time() );
        $supplier_key_meta = update_post_meta( $post_id, '_cdh_supplier_key', $supplier_key );
        $supplier_id_meta  = update_post_meta( $post_id, '_cdh_supplier_product_id', $supplier_product_id );
        update_post_meta( $post_id, '_cdh_import_identity_hash', self::import_identity_hash( $supplier_key, $supplier_product_id ) );
        if ( false === $import_state_meta || false === $import_started_meta || false === $supplier_key_meta || false === $supplier_id_meta ) {
            wp_delete_post( $post_id, true );
            self::release_import_lock( $import_lock );
            return new WP_Error( 'cdh_import_identity_persist_failed', __( 'L’identité fournisseur ne peut pas être réservée. Aucun produit n’a été conservé.', 'constello-dropship-hub' ), array( 'status' => 500 ) );
        }
        self::release_import_lock( $import_lock );

        $product = $has_variants && class_exists( 'WC_Product_Variable' )
            ? new WC_Product_Variable( $post_id )
            : new WC_Product_Simple( $post_id );
        if ( ! $has_variants ) {
            $product->set_regular_price( wc_format_decimal( $variation_pricing['base_regular_price'] ) );
        }
        $product->set_status( CDH_Import_AliExpress_Status::STATUS );

        $category_id = isset( $payload['category_id'] ) ? absint( $payload['category_id'] ) : 0;
        if ( $category_id && term_exists( $category_id, 'product_cat' ) ) {
            $product->set_category_ids( array( $category_id ) );
        }

        self::apply_attributes( $product, $payload['variants'] ?? array(), $payload['attributes'] ?? array() );
        $product->save();
        $created_variations = 0;
        if ( $has_variants && $product instanceof WC_Product_Variable ) {
            $created_variations = self::create_priced_variations( $product, $variation_pricing, $payload['variants'] ?? array() );
        }

        update_post_meta( $post_id, '_cdh_supplier_url', esc_url_raw( (string) ( $payload['supplier_url'] ?? '' ) ) );
        update_post_meta( $post_id, '_cdh_imported_at', current_time( 'mysql', true ) );
        update_post_meta( $post_id, '_cdh_import_source', 'extension' );
        update_post_meta( $post_id, '_cdh_supplier_base_price', wc_format_decimal( $price ) );
        update_post_meta( $post_id, '_cdh_supplier_currency', $input_currency );
        update_post_meta( $post_id, '_cdh_pricing_currency', $variation_pricing['currency'] );
        update_post_meta( $post_id, '_cdh_pricing_base_regular', wc_format_decimal( $variation_pricing['base_regular_price'] ) );
        update_post_meta( $post_id, '_cdh_variation_pricing', wp_json_encode( $variation_pricing, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES ) );
        update_post_meta( $post_id, '_cdh_pricing_rule_name', sanitize_text_field( (string) ( $variation_pricing['rule_name'] ?? '' ) ) );
        update_post_meta( $post_id, '_cdh_pricing_rule_version', absint( $variation_pricing['rule_version'] ?? 0 ) );

        $supplier = isset( $payload['supplier'] ) && is_array( $payload['supplier'] ) ? $payload['supplier'] : array();
        $store_name = sanitize_text_field( (string) ( $supplier['store_name'] ?? '' ) );
        $store_url  = esc_url_raw( (string) ( $supplier['store_url'] ?? '' ), array( 'https' ) );
        $seller_id  = sanitize_text_field( (string) ( $supplier['seller_id'] ?? '' ) );
        $sold_count_text = sanitize_text_field( (string) ( $supplier['sold_count_text'] ?? '' ) );
        $observed_at = sanitize_text_field( (string) ( $supplier['observed_at'] ?? '' ) );
        if ( '' === $observed_at ) {
            $observed_at = current_time( 'mysql', true );
        }
        update_post_meta( $post_id, '_cdh_supplier_store_name', $store_name );
        update_post_meta( $post_id, '_cdh_supplier_store_url', $store_url );
        update_post_meta( $post_id, '_cdh_supplier_seller_id', $seller_id );
        update_post_meta( $post_id, '_cdh_supplier_sold_count_text', $sold_count_text );
        update_post_meta( $post_id, '_cdh_supplier_brand', sanitize_text_field( (string) ( $payload['brand'] ?? '' ) ) );
        update_post_meta( $post_id, '_cdh_supplier_observed_at', $observed_at );
        update_post_meta( $post_id, '_cdh_supplier_availability', sanitize_text_field( (string) ( $payload['availability'] ?? '' ) ) );
        $rating_value = isset( $payload['rating']['value'] ) && null !== $payload['rating']['value'] ? (float) $payload['rating']['value'] : '';
        $rating_count = isset( $payload['rating']['count'] ) && null !== $payload['rating']['count'] ? absint( $payload['rating']['count'] ) : '';
        update_post_meta( $post_id, '_cdh_supplier_rating_value', $rating_value );
        update_post_meta( $post_id, '_cdh_supplier_rating_count', $rating_count );

        $raw_attributes = self::sanitize_supplier_attributes( $payload['attributes'] ?? array() );
        update_post_meta( $post_id, '_cdh_supplier_attributes_raw', wp_json_encode( $raw_attributes, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES ) );
        if ( class_exists( 'CDH_Catalog_Settings' ) ) {
            CDH_Catalog_Settings::learn_from_variants( $payload['variants'] ?? array() );
        }
        update_post_meta( $post_id, '_cdh_supplier_variants_raw', wp_json_encode( is_array( $payload['variants'] ?? null ) ? $payload['variants'] : array(), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES ) );
        update_post_meta( $post_id, '_cdh_supplier_variations_raw', wp_json_encode( $supplier_variations, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES ) );

        // Baseline SKU supplier snapshot. Price and stock stay source observations only; this RC
        // deliberately does NOT change WooCommerce stock. A future monitor can compare a fresh
        // snapshot against this baseline/current snapshot without losing the supplier SKU identity.
        $sku_snapshot_observed_at = sanitize_text_field( (string) ( $payload['supplier_sku_captured_at'] ?? '' ) );
        if ( '' === $sku_snapshot_observed_at ) $sku_snapshot_observed_at = $observed_at;
        $sku_snapshot_source = sanitize_text_field( (string) ( $payload['supplier_sku_source'] ?? '' ) );
        $sku_snapshot_rows = array();
        $sku_stock_qty_count = 0;
        $sku_stock_status_count = 0;
        $sku_out_of_stock_count = 0;
        foreach ( $supplier_variations as $supplier_variation ) {
            if ( ! is_array( $supplier_variation ) ) continue;
            $stock_qty = array_key_exists( 'stock_qty', $supplier_variation ) ? $supplier_variation['stock_qty'] : ( $supplier_variation['stock'] ?? null );
            $stock_status = sanitize_key( (string) ( $supplier_variation['stock_status'] ?? 'unknown' ) );
            if ( ! in_array( $stock_status, array( 'in_stock', 'out_of_stock', 'unknown' ), true ) ) $stock_status = 'unknown';
            if ( null !== $stock_qty ) $sku_stock_qty_count++;
            if ( 'unknown' !== $stock_status ) $sku_stock_status_count++;
            if ( 'out_of_stock' === $stock_status ) $sku_out_of_stock_count++;
            $sku_snapshot_rows[] = array(
                'supplier_sku_id' => sanitize_text_field( (string) ( $supplier_variation['supplier_sku_id'] ?? '' ) ),
                'sku_attr' => sanitize_text_field( (string) ( $supplier_variation['sku_attr'] ?? '' ) ),
                'attributes' => is_array( $supplier_variation['attributes'] ?? null ) ? $supplier_variation['attributes'] : array(),
                'supplier_price' => is_array( $supplier_variation['supplier_price'] ?? null ) ? $supplier_variation['supplier_price'] : array(),
                'stock_qty' => null !== $stock_qty ? (float) $stock_qty : null,
                'stock_status' => $stock_status,
                'available' => isset( $supplier_variation['available'] ) && null !== $supplier_variation['available'] ? (bool) $supplier_variation['available'] : null,
                'observed_at' => sanitize_text_field( (string) ( $supplier_variation['observed_at'] ?? $sku_snapshot_observed_at ) ),
            );
        }
        $sku_snapshot = array(
            'schema_version' => 1,
            'supplier_key' => $supplier_key,
            'supplier_product_id' => $supplier_product_id,
            'source' => $sku_snapshot_source,
            'observed_at' => $sku_snapshot_observed_at,
            'currency' => $input_currency,
            'sku_count' => count( $sku_snapshot_rows ),
            'stock_qty_count' => $sku_stock_qty_count,
            'stock_status_count' => $sku_stock_status_count,
            'out_of_stock_count' => $sku_out_of_stock_count,
            'rows' => $sku_snapshot_rows,
        );
        $sku_snapshot_json = wp_json_encode( $sku_snapshot, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES );
        update_post_meta( $post_id, '_cdh_supplier_sku_snapshot_v1', $sku_snapshot_json );
        update_post_meta( $post_id, '_cdh_supplier_sku_baseline_v1', $sku_snapshot_json );
        update_post_meta( $post_id, '_cdh_supplier_sku_source', $sku_snapshot_source );
        update_post_meta( $post_id, '_cdh_supplier_sku_observed_at', $sku_snapshot_observed_at );
        update_post_meta( $post_id, '_cdh_supplier_sku_count', count( $sku_snapshot_rows ) );
        update_post_meta( $post_id, '_cdh_supplier_stock_qty_count', $sku_stock_qty_count );
        update_post_meta( $post_id, '_cdh_supplier_stock_status_count', $sku_stock_status_count );
        update_post_meta( $post_id, '_cdh_supplier_out_of_stock_count', $sku_out_of_stock_count );

        // Supplier shipping is stored independently from the product/SKU price. Calendar dates
        // are evidence only; monitoring will compare normalized relative delay days.
        if ( $shipping_current ) {
            $shipping_json = wp_json_encode( $shipping_current, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES );
            update_post_meta( $post_id, '_cdh_supplier_shipping_current_v1', $shipping_json );
            update_post_meta( $post_id, '_cdh_supplier_shipping_snapshot_v1', $shipping_json );
            if ( '' === (string) get_post_meta( $post_id, '_cdh_supplier_shipping_baseline_v1', true ) ) update_post_meta( $post_id, '_cdh_supplier_shipping_baseline_v1', $shipping_json );
            if ( ! empty( $shipping_current['fee_known'] ) ) update_post_meta( $post_id, '_cdh_supplier_shipping_fee', wc_format_decimal( (float) $shipping_current['fee'] ) );
            if ( null !== ( $shipping_current['landed_cost'] ?? null ) ) update_post_meta( $post_id, '_cdh_supplier_landed_cost', wc_format_decimal( (float) $shipping_current['landed_cost'] ) );
            update_post_meta( $post_id, '_cdh_supplier_shipping_observed_at', sanitize_text_field( (string) ( $shipping_current['observed_at'] ?? '' ) ) );
        }

        update_post_meta( $post_id, '_cdh_supplier_data_json', wp_json_encode( array(
            'platform'   => $supplier_key,
            'store_name' => $store_name,
            'store_url'  => $store_url,
            'seller_id'  => $seller_id,
            'sold_count' => $sold_count_text,
            'product_id' => $supplier_product_id,
            'product_url'=> esc_url_raw( (string) ( $payload['supplier_url'] ?? '' ), array( 'https' ) ),
            'brand'      => sanitize_text_field( (string) ( $payload['brand'] ?? '' ) ),
        ), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES ) );
        update_post_meta( $post_id, '_cdh_supplier_history', array( array(
            'observed_at'  => $observed_at,
            'price'        => wc_format_decimal( $price ),
            'currency'     => $input_currency,
            'shipping_fee' => $shipping_current && ! empty( $shipping_current['fee_known'] ) ? wc_format_decimal( (float) $shipping_current['fee'] ) : null,
            'shipping_currency' => $shipping_current ? sanitize_text_field( (string) ( $shipping_current['currency'] ?? '' ) ) : '',
            'delivery_min_days' => $shipping_current ? ( $shipping_current['delivery_min_days'] ?? null ) : null,
            'delivery_max_days' => $shipping_current ? ( $shipping_current['delivery_max_days'] ?? null ) : null,
            'landed_cost' => $shipping_current && null !== ( $shipping_current['landed_cost'] ?? null ) ? wc_format_decimal( (float) $shipping_current['landed_cost'] ) : null,
            'availability' => sanitize_text_field( (string) ( $payload['availability'] ?? '' ) ),
            'rating'       => $rating_value,
            'rating_count' => $rating_count,
            'variation_count' => count( $supplier_variations ),
        ) ) );

        $media_ids = self::resolve_images( array_slice( $images, 0, 12 ), array_slice( $image_media_ids, 0, 12 ), $post_id );
        if ( $media_ids ) {
            set_post_thumbnail( $post_id, array_shift( $media_ids ) );
            if ( $media_ids ) {
                update_post_meta( $post_id, '_product_image_gallery', implode( ',', array_map( 'absint', $media_ids ) ) );
            }
        }

        if ( $video_requested && $video_media_id ) {
            wp_update_post( array( 'ID' => $video_media_id, 'post_parent' => $post_id ) );
            delete_post_meta( $video_media_id, '_cdh_temp_import_video' );
            delete_post_meta( $video_media_id, '_cdh_temp_media_created_at' );
            $video_url = esc_url_raw( (string) wp_get_attachment_url( $video_media_id ), array( 'https' ) );
            $supplier_video_url = esc_url_raw( (string) ( $video_payload['source_url'] ?? '' ), array( 'https' ) );
            $video_poster = esc_url_raw( (string) ( $video_payload['thumbnail_url'] ?? '' ), array( 'https' ) );
            update_post_meta( $post_id, '_cdh_video_attachment_id', $video_media_id );
            update_post_meta( $post_id, '_cdh_video_url', $video_url );
            update_post_meta( $post_id, '_cdh_supplier_video_url', $supplier_video_url );
            if ( $video_poster ) update_post_meta( $post_id, '_cdh_video_poster_url', $video_poster );
            if ( ! empty( $video_payload['add_to_description'] ) && $video_url ) {
                $current_content = (string) get_post_field( 'post_content', $post_id );
                $poster_attr = $video_poster ? ' poster="' . esc_url( $video_poster ) . '"' : '';
                $video_html = '<div class="cdh-product-video"><video controls preload="metadata" playsinline' . $poster_attr . ' style="max-width:100%;height:auto"><source src="' . esc_url( $video_url ) . '" type="' . esc_attr( (string) get_post_mime_type( $video_media_id ) ) . '"></video></div>';
                wp_update_post( array( 'ID' => $post_id, 'post_content' => $current_content . $video_html ) );
            }
        }

        $document_attachment_ids = array();
        foreach ( $validated_documents as &$document ) {
            $media_id = absint( $document['media_id'] ?? 0 );
            if ( $media_id && ! empty( $document['import_to_wordpress'] ) ) {
                wp_update_post( array( 'ID' => $media_id, 'post_parent' => $post_id ) );
                delete_post_meta( $media_id, '_cdh_temp_import_document' );
                delete_post_meta( $media_id, '_cdh_temp_media_created_at' );
                $document['url'] = esc_url_raw( (string) wp_get_attachment_url( $media_id ), array( 'https' ) );
                $document_attachment_ids[] = $media_id;
            }
        }
        unset( $document );
        update_post_meta( $post_id, '_cdh_supplier_documents_v1', wp_json_encode( $validated_documents, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES ) );
        update_post_meta( $post_id, '_cdh_document_attachment_ids', array_values( array_unique( array_map( 'absint', $document_attachment_ids ) ) ) );

        $size_guide = self::sanitize_size_guide( $payload['size_guide'] ?? null );
        if ( $size_guide ) update_post_meta( $post_id, '_cdh_size_guide_v1', wp_json_encode( $size_guide, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES ) );

        $import_completed = update_post_meta( $post_id, '_cdh_import_state', 'complete' );
        update_post_meta( $post_id, '_cdh_import_completed_at', time() );
        if ( false === $import_completed ) {
            return new WP_Error(
                'cdh_import_completion_persist_failed',
                __( 'Le produit a été créé, mais son état final d’import n’a pas pu être enregistré. Vérifiez sa fiche avant toute relance.', 'constello-dropship-hub' ),
                array( 'status' => 500, 'product_id' => (int) $post_id, 'review_url' => get_edit_post_link( $post_id, 'raw' ) )
            );
        }

        return new WP_REST_Response( array(
            'product_id'  => (int) $post_id,
            'status'      => CDH_Import_AliExpress_Status::STATUS,
            'review_url'  => get_edit_post_link( $post_id, 'raw' ),
            'created'     => true,
            'idempotent_replay' => false,
            'import_action' => 'created',
            'supplier_key' => $supplier_key,
            'supplier_product_id' => $supplier_product_id,
            'variations_created' => (int) $created_variations,
            'video_media_id' => $video_requested ? (int) $video_media_id : 0,
            'document_count' => count( $document_attachment_ids ),
            'size_guide_imported' => ! empty( $size_guide ),
            'shipping_observed' => ! empty( $shipping_current ),
            'pricing_rule' => array(
                'name' => (string) ( $variation_pricing['rule_name'] ?? '' ),
                'version' => (int) ( $variation_pricing['rule_version'] ?? 0 ),
            ),
        ), 201 );
    }


    private static function sanitize_supplier_shipping( $raw, $base_price, $shop_currency ) {
        if ( ! is_array( $raw ) ) return array();
        $has_fee_value = array_key_exists( 'fee', $raw ) && null !== $raw['fee'] && '' !== trim( (string) $raw['fee'] ) && is_numeric( $raw['fee'] );
        $fee_known = ! empty( $raw['fee_known'] ) || $has_fee_value || ! empty( $raw['is_free_shipping'] );
        $fee = $has_fee_value ? (float) $raw['fee'] : ( ! empty( $raw['is_free_shipping'] ) ? 0.0 : null );
        $currency = strtoupper( sanitize_text_field( (string) ( $raw['currency'] ?? $shop_currency ) ) );
        $shop_currency = strtoupper( sanitize_text_field( (string) $shop_currency ) );
        $currency_matches = '' === $currency || '' === $shop_currency || $currency === $shop_currency;
        $reference_price = isset( $raw['reference_supplier_price'] ) && is_numeric( $raw['reference_supplier_price'] ) && (float) $raw['reference_supplier_price'] > 0 ? (float) $raw['reference_supplier_price'] : (float) $base_price;
        $min_days = isset( $raw['delivery_min_days'] ) && is_numeric( $raw['delivery_min_days'] ) ? max( 0, (int) $raw['delivery_min_days'] ) : null;
        $max_days = isset( $raw['delivery_max_days'] ) && is_numeric( $raw['delivery_max_days'] ) ? max( 0, (int) $raw['delivery_max_days'] ) : null;
        if ( null !== $min_days && null !== $max_days && $max_days < $min_days ) { $tmp = $min_days; $min_days = $max_days; $max_days = $tmp; }
        $date_start = sanitize_text_field( (string) ( $raw['delivery_date_start'] ?? '' ) );
        $date_end = sanitize_text_field( (string) ( $raw['delivery_date_end'] ?? '' ) );
        if ( $date_start && ! preg_match( '/^\d{4}-\d{2}-\d{2}$/', $date_start ) ) $date_start = '';
        if ( $date_end && ! preg_match( '/^\d{4}-\d{2}-\d{2}$/', $date_end ) ) $date_end = '';
        $selected_attributes = array();
        foreach ( is_array( $raw['selected_attributes'] ?? null ) ? $raw['selected_attributes'] : array() as $attribute ) {
            if ( ! is_array( $attribute ) ) continue;
            $selected_attributes[] = array(
                'property_id' => sanitize_text_field( (string) ( $attribute['property_id'] ?? '' ) ),
                'value_id' => sanitize_text_field( (string) ( $attribute['value_id'] ?? '' ) ),
                'value' => sanitize_text_field( (string) ( $attribute['value'] ?? '' ) ),
            );
        }
        $observed_at = sanitize_text_field( (string) ( $raw['observed_at'] ?? '' ) );
        if ( '' === $observed_at ) $observed_at = current_time( 'mysql', true );
        return array(
            'schema_version' => 1,
            'fee' => $fee_known ? $fee : null,
            'fee_known' => $fee_known && null !== $fee,
            'currency' => $currency,
            'currency_matches_shop' => $currency_matches,
            'is_free_shipping' => $fee_known && null !== $fee && 0.0 === (float) $fee,
            'method' => sanitize_text_field( (string) ( $raw['method'] ?? '' ) ),
            'delivery_text' => sanitize_text_field( (string) ( $raw['delivery_text'] ?? '' ) ),
            'delivery_date_start' => $date_start,
            'delivery_date_end' => $date_end,
            'delivery_min_days' => $min_days,
            'delivery_max_days' => $max_days,
            'destination_country' => strtoupper( sanitize_text_field( (string) ( $raw['destination_country'] ?? '' ) ) ),
            'quantity' => max( 1, absint( $raw['quantity'] ?? 1 ) ),
            'scope' => sanitize_key( (string) ( $raw['scope'] ?? 'current_selection' ) ),
            'supplier_sku_id' => sanitize_text_field( (string) ( $raw['supplier_sku_id'] ?? '' ) ),
            'selected_attributes' => $selected_attributes,
            'reference_supplier_price' => $reference_price > 0 ? $reference_price : null,
            'landed_cost' => $fee_known && null !== $fee && $currency_matches && $reference_price > 0 ? round( $reference_price + (float) $fee, wc_get_price_decimals() ) : null,
            'source' => sanitize_key( (string) ( $raw['source'] ?? 'aliexpress_dom' ) ),
            'observed_at' => $observed_at,
            'monitor_basis' => array( 'shipping_fee', 'shipping_method', 'delivery_delay_days', 'landed_cost' ),
        );
    }


    private static function sanitize_size_guide( $raw ) {
        if ( ! is_array( $raw ) ) return array();
        $sizes = array();
        foreach ( is_array( $raw['sizes'] ?? null ) ? $raw['sizes'] : array() as $size ) {
            if ( ! is_array( $size ) ) continue;
            $label = sanitize_text_field( (string) ( $size['source_value'] ?? '' ) );
            if ( '' === $label ) continue;
            $measurements = array();
            foreach ( is_array( $size['measurements'] ?? null ) ? $size['measurements'] : array() as $measurement ) {
                if ( ! is_array( $measurement ) ) continue;
                $name = sanitize_text_field( (string) ( $measurement['name'] ?? '' ) );
                if ( '' === $name ) continue;
                $value_type = sanitize_key( (string) ( $measurement['value_type'] ?? '' ) );
                if ( ! in_array( $value_type, array( 'single', 'range', 'text' ), true ) ) {
                    $value_type = ( isset( $measurement['min'], $measurement['max'] ) && is_numeric( $measurement['min'] ) && is_numeric( $measurement['max'] ) ) ? 'range' : 'single';
                }
                $value = $measurement['value'] ?? null;
                $value = null !== $value && '' !== (string) $value ? ( is_numeric( $value ) ? (float) $value : sanitize_text_field( (string) $value ) ) : null;
                $min = isset( $measurement['min'] ) && is_numeric( $measurement['min'] ) ? (float) $measurement['min'] : null;
                $max = isset( $measurement['max'] ) && is_numeric( $measurement['max'] ) ? (float) $measurement['max'] : null;
                if ( 'range' === $value_type && ( null === $min || null === $max || $min > $max ) ) $value_type = 'text';
                $source = sanitize_key( (string) ( $measurement['source'] ?? 'aliexpress' ) );
                if ( ! in_array( $source, array( 'aliexpress', 'manual' ), true ) ) $source = 'aliexpress';
                $supplier_value = array_key_exists( 'supplier_value', $measurement ) && null !== $measurement['supplier_value'] && '' !== (string) $measurement['supplier_value']
                    ? ( is_numeric( $measurement['supplier_value'] ) ? (float) $measurement['supplier_value'] : sanitize_text_field( (string) $measurement['supplier_value'] ) )
                    : null;
                $supplier_min = isset( $measurement['supplier_min'] ) && is_numeric( $measurement['supplier_min'] ) ? (float) $measurement['supplier_min'] : null;
                $supplier_max = isset( $measurement['supplier_max'] ) && is_numeric( $measurement['supplier_max'] ) ? (float) $measurement['supplier_max'] : null;
                $measurements[] = array(
                    'name' => $name,
                    'value_type' => $value_type,
                    'value' => $value,
                    'min' => $min,
                    'max' => $max,
                    'unit' => sanitize_text_field( (string) ( $measurement['unit'] ?? '' ) ),
                    'raw_value' => sanitize_text_field( (string) ( $measurement['raw_value'] ?? '' ) ),
                    'raw_unit' => sanitize_text_field( (string) ( $measurement['raw_unit'] ?? '' ) ),
                    'unit_source' => sanitize_key( (string) ( $measurement['unit_source'] ?? '' ) ),
                    'unit_conflict' => ! empty( $measurement['unit_conflict'] ),
                    'source' => $source,
                    'supplier_value' => $supplier_value,
                    'supplier_min' => $supplier_min,
                    'supplier_max' => $supplier_max,
                    'supplier_unit' => sanitize_text_field( (string) ( $measurement['supplier_unit'] ?? '' ) ),
                    'supplier_raw_value' => sanitize_text_field( (string) ( $measurement['supplier_raw_value'] ?? '' ) ),
                    'manual_updated_at' => sanitize_text_field( (string) ( $measurement['manual_updated_at'] ?? '' ) ),
                );
            }
            $sizes[] = array(
                'source_value' => $label,
                'target_value' => sanitize_text_field( (string) ( $size['target_value'] ?? $label ) ),
                'source_value_id' => sanitize_text_field( (string) ( $size['source_value_id'] ?? '' ) ),
                'measurements' => $measurements,
            );
        }
        if ( ! $sizes ) return array();
        return array(
            'source_attribute' => sanitize_text_field( (string) ( $raw['source_attribute'] ?? 'Taille' ) ),
            'target_attribute' => sanitize_text_field( (string) ( $raw['target_attribute'] ?? $raw['source_attribute'] ?? 'Taille' ) ),
            'source_property_id' => sanitize_text_field( (string) ( $raw['source_property_id'] ?? '' ) ),
            'unit' => sanitize_text_field( (string) ( $raw['unit'] ?? '' ) ),
            'sizes' => $sizes,
            'observed_at' => sanitize_text_field( (string) ( $raw['observed_at'] ?? '' ) ),
        );
    }

    private static function ensure_global_attribute( $name, $attribute_id = 0, $taxonomy = '' ) {
        $name = sanitize_text_field( (string) $name );
        $attribute_id = absint( $attribute_id );
        $taxonomy = sanitize_key( (string) $taxonomy );
        if ( $attribute_id && function_exists( 'wc_attribute_taxonomy_name_by_id' ) ) {
            $resolved = wc_attribute_taxonomy_name_by_id( $attribute_id );
            if ( $resolved ) $taxonomy = $resolved;
        }
        if ( ! $attribute_id && function_exists( 'wc_get_attribute_taxonomies' ) ) {
            foreach ( wc_get_attribute_taxonomies() as $item ) {
                $candidate_name = (string) ( $item->attribute_label ?? $item->attribute_name ?? '' );
                if ( sanitize_title( $candidate_name ) === sanitize_title( $name ) ) {
                    $attribute_id = absint( $item->attribute_id ?? 0 );
                    $taxonomy = function_exists( 'wc_attribute_taxonomy_name' ) ? wc_attribute_taxonomy_name( (string) $item->attribute_name ) : 'pa_' . sanitize_title( (string) $item->attribute_name );
                    break;
                }
            }
        }
        if ( ! $attribute_id && function_exists( 'wc_create_attribute' ) && '' !== $name ) {
            $slug = substr( sanitize_title( $name ), 0, 28 );
            $created = wc_create_attribute( array( 'name' => $name, 'slug' => $slug, 'type' => 'select', 'order_by' => 'menu_order', 'has_archives' => false ) );
            if ( ! is_wp_error( $created ) ) {
                $attribute_id = absint( $created );
                $taxonomy = function_exists( 'wc_attribute_taxonomy_name' ) ? wc_attribute_taxonomy_name( $slug ) : 'pa_' . $slug;
            }
        }
        if ( $taxonomy && ! taxonomy_exists( $taxonomy ) ) {
            register_taxonomy( $taxonomy, array( 'product' ), array( 'hierarchical' => false, 'show_ui' => false, 'query_var' => true, 'rewrite' => false, 'public' => false, 'label' => $name ) );
        }
        return array( 'id' => $attribute_id, 'taxonomy' => $taxonomy, 'name' => $name );
    }

    private static function variation_groups_for_creation( $variants ) {
        $groups = array();
        if ( ! is_array( $variants ) ) return $groups;
        foreach ( $variants as $variant ) {
            if ( ! is_array( $variant ) ) continue;
            $value = sanitize_text_field( (string) ( $variant['label_raw'] ?? '' ) );
            if ( '' === $value ) continue;
            $target_type = sanitize_key( (string) ( $variant['target_attribute_type'] ?? 'product' ) );
            if ( ! in_array( $target_type, array( 'global', 'create_global', 'product' ), true ) ) $target_type = 'product';
            $name = sanitize_text_field( (string) ( $variant['target_attribute_name'] ?? $variant['dimension_label'] ?? '' ) );
            if ( '' === $name ) continue;
            $attribute_id = absint( $variant['target_attribute_id'] ?? 0 );
            $taxonomy = sanitize_key( (string) ( $variant['target_attribute_taxonomy'] ?? '' ) );
            if ( 'global' === $target_type || 'create_global' === $target_type ) {
                $resolved = self::ensure_global_attribute( $name, $attribute_id, $taxonomy );
                $attribute_id = $resolved['id'];
                $taxonomy = $resolved['taxonomy'];
                if ( ! $attribute_id || ! $taxonomy ) $target_type = 'product';
            }
            $key = ( 'global' === $target_type || 'create_global' === $target_type ) && $taxonomy ? $taxonomy : sanitize_title( $name );
            if ( '' === $key || 'x' === $key ) continue;
            if ( ! isset( $groups[ $key ] ) ) {
                $groups[ $key ] = array(
                    'key' => $key, 'pricing_key' => $key, 'name' => $name, 'target_type' => $target_type,
                    'attribute_id' => $attribute_id, 'taxonomy' => $taxonomy, 'values' => array(), 'option_ids' => array(),
                );
            }
            $stored_value = $value;
            $term_id = 0;
            if ( ( 'global' === $target_type || 'create_global' === $target_type ) && $taxonomy ) {
                $exists = term_exists( $value, $taxonomy );
                if ( ! $exists ) $exists = wp_insert_term( $value, $taxonomy );
                if ( is_array( $exists ) ) $term_id = absint( $exists['term_id'] ?? 0 );
                elseif ( is_int( $exists ) ) $term_id = absint( $exists );
                if ( $term_id ) {
                    $term = get_term( $term_id, $taxonomy );
                    if ( $term && ! is_wp_error( $term ) ) $stored_value = (string) $term->slug;
                    $groups[ $key ]['option_ids'][] = $term_id;
                }
            }
            $groups[ $key ]['values'][ strtolower( $value ) ] = array(
                'display' => $value,
                'stored' => $stored_value,
                'term_id' => $term_id,
                'image_media_id' => absint( $variant['image_media_id'] ?? 0 ),
            );
        }
        return $groups;
    }

    private static function create_priced_variations( WC_Product_Variable $product, $pricing, $variants ) {
        $groups = self::variation_groups_for_creation( $variants );
        if ( ! $groups || empty( $pricing['combinations'] ) || ! is_array( $pricing['combinations'] ) ) return 0;
        $allowed_variant_media = array();
        foreach ( $groups as $group ) foreach ( (array) ( $group['values'] ?? array() ) as $value_info ) {
            $mid = absint( $value_info['image_media_id'] ?? 0 );
            if ( $mid && 'attachment' === get_post_type( $mid ) && wp_attachment_is_image( $mid ) && '1' === (string) get_post_meta( $mid, '_cdh_temp_import_media', true ) ) $allowed_variant_media[ $mid ] = true;
        }
        $created = 0;
        $seen = array();
        foreach ( $pricing['combinations'] as $combo ) {
            if ( $created >= 200 || ! is_array( $combo ) ) break;
            $attrs = array();
            $variation_image_id = 0;
            foreach ( is_array( $combo['attributes'] ?? null ) ? $combo['attributes'] : array() as $attribute ) {
                if ( ! is_array( $attribute ) ) continue;
                $name_raw = sanitize_text_field( (string) ( $attribute['name'] ?? '' ) );
                $name_key = isset( $groups[ $name_raw ] ) ? $name_raw : sanitize_title( $name_raw );
                $value_raw = sanitize_text_field( (string) ( $attribute['value'] ?? '' ) );
                if ( ! isset( $groups[ $name_key ] ) || '' === $value_raw ) continue;
                $lookup = strtolower( $value_raw );
                if ( ! isset( $groups[ $name_key ]['values'][ $lookup ] ) ) continue;
                $attrs[ $groups[ $name_key ]['key'] ] = $groups[ $name_key ]['values'][ $lookup ]['stored'];
                if ( ! empty( $groups[ $name_key ]['values'][ $lookup ]['image_media_id'] ) ) { $candidate_media_id = absint( $groups[ $name_key ]['values'][ $lookup ]['image_media_id'] ); if ( isset( $allowed_variant_media[ $candidate_media_id ] ) ) $variation_image_id = $candidate_media_id; }
            }
            if ( count( $attrs ) !== count( $groups ) ) continue;
            ksort( $attrs );
            $signature = wp_json_encode( $attrs );
            if ( isset( $seen[ $signature ] ) ) continue;
            $seen[ $signature ] = true;
            $regular = (float) ( $combo['regular_price'] ?? 0 );
            if ( ! ( $regular > 0 ) ) continue;
            try {
                $variation = new WC_Product_Variation();
                $variation->set_parent_id( $product->get_id() );
                $variation->set_status( 'publish' );
                $variation->set_attributes( $attrs );
                $variation->set_regular_price( wc_format_decimal( $regular ) );
                $variation->set_price( wc_format_decimal( $regular ) );
                if ( $variation_image_id ) $variation->set_image_id( $variation_image_id );
                $variation->save();
                $variation_id = $variation->get_id();
                if ( $variation_id ) {
                    update_post_meta( $variation_id, '_cdh_supplier_sku_id', sanitize_text_field( (string) ( $combo['supplier_sku_id'] ?? '' ) ) );
                    update_post_meta( $variation_id, '_cdh_supplier_sku_attr', sanitize_text_field( (string) ( $combo['sku_attr'] ?? '' ) ) );
                    update_post_meta( $variation_id, '_cdh_supplier_price', wc_format_decimal( (float) ( $combo['supplier_price'] ?? 0 ) ) );
                    update_post_meta( $variation_id, '_cdh_supplier_regular_price', wc_format_decimal( (float) ( $combo['supplier_regular_price'] ?? 0 ) ) );
                    update_post_meta( $variation_id, '_cdh_supplier_currency', sanitize_text_field( (string) ( $combo['supplier_currency'] ?? '' ) ) );
                    $supplier_stock_qty = array_key_exists( 'supplier_stock_qty', $combo ) ? $combo['supplier_stock_qty'] : ( $combo['supplier_stock'] ?? null );
                    if ( null !== $supplier_stock_qty ) {
                        update_post_meta( $variation_id, '_cdh_supplier_stock_observed', (float) $supplier_stock_qty );
                        update_post_meta( $variation_id, '_cdh_supplier_stock_qty', (float) $supplier_stock_qty );
                    } else {
                        delete_post_meta( $variation_id, '_cdh_supplier_stock_qty' );
                    }
                    $supplier_stock_status = sanitize_key( (string) ( $combo['supplier_stock_status'] ?? 'unknown' ) );
                    if ( ! in_array( $supplier_stock_status, array( 'in_stock', 'out_of_stock', 'unknown' ), true ) ) $supplier_stock_status = 'unknown';
                    update_post_meta( $variation_id, '_cdh_supplier_stock_status', $supplier_stock_status );
                    if ( array_key_exists( 'supplier_available', $combo ) && null !== $combo['supplier_available'] ) update_post_meta( $variation_id, '_cdh_supplier_available', ! empty( $combo['supplier_available'] ) ? '1' : '0' );
                    else delete_post_meta( $variation_id, '_cdh_supplier_available' );
                    $sku_observed_at = sanitize_text_field( (string) ( $combo['supplier_observed_at'] ?? '' ) );
                    update_post_meta( $variation_id, '_cdh_supplier_observed_at', $sku_observed_at ?: current_time( 'mysql', true ) );
                    update_post_meta( $variation_id, '_cdh_pricing_rule_name', sanitize_text_field( (string) ( $combo['pricing_rule_name'] ?? ( $pricing['rule_name'] ?? '' ) ) ) );
                    update_post_meta( $variation_id, '_cdh_pricing_rule_version', absint( $combo['pricing_rule_version'] ?? ( $pricing['rule_version'] ?? 0 ) ) );
                    update_post_meta( $variation_id, '_cdh_pricing_trace', wp_json_encode( is_array( $combo['pricing_trace'] ?? null ) ? $combo['pricing_trace'] : array(), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES ) );
                    delete_post_meta( $variation_id, '_cdh_pricing_manual_override' );
                }
                $created++;
            } catch ( Throwable $e ) {
                // One invalid variation must not abort the whole import; the pricing meta remains auditable.
            }
        }
        foreach ( array_keys( $allowed_variant_media ) as $media_id ) {
            wp_update_post( array( 'ID' => $media_id, 'post_parent' => $product->get_id() ) );
            delete_post_meta( $media_id, '_cdh_temp_import_media' );
            delete_post_meta( $media_id, '_cdh_temp_media_created_at' );
        }
        if ( $created ) {
            WC_Product_Variable::sync( $product->get_id() );
            wc_delete_product_transients( $product->get_id() );
        }
        return $created;
    }

    private static function has_valid_variants( $variants ) {
        if ( ! is_array( $variants ) ) {
            return false;
        }
        foreach ( $variants as $variant ) {
            if ( ! is_array( $variant ) ) continue;
            $key = sanitize_text_field( (string) ( $variant['supplier_variation_key'] ?? '' ) );
            $value = sanitize_text_field( (string) ( $variant['label_raw'] ?? '' ) );
            if ( $key && $value && false !== strpos( $key, ':' ) ) {
                return true;
            }
        }
        return false;
    }

    private static function sanitize_supplier_variations( $variations, $shop_currency, $fallback_observed_at = '' ) {
        if ( ! is_array( $variations ) ) return array();
        $out = array();
        $shop_currency = strtoupper( sanitize_text_field( (string) $shop_currency ) );
        $fallback_observed_at = sanitize_text_field( (string) $fallback_observed_at );
        foreach ( array_slice( $variations, 0, 300 ) as $variation ) {
            if ( ! is_array( $variation ) ) continue;
            $attrs = array();
            foreach ( is_array( $variation['attributes'] ?? null ) ? $variation['attributes'] : array() as $attribute ) {
                if ( ! is_array( $attribute ) ) continue;
                $attrs[] = array(
                    'property_id' => sanitize_text_field( (string) ( $attribute['property_id'] ?? '' ) ),
                    'value_id'    => sanitize_text_field( (string) ( $attribute['value_id'] ?? '' ) ),
                    'name'        => sanitize_text_field( (string) ( $attribute['name'] ?? '' ) ),
                    'value'       => sanitize_text_field( (string) ( $attribute['value'] ?? '' ) ),
                );
            }
            $price_obj = is_array( $variation['supplier_price'] ?? null ) ? $variation['supplier_price'] : array();
            $price = (float) ( $price_obj['amount'] ?? 0 );
            $currency = strtoupper( sanitize_text_field( (string) ( $price_obj['currency'] ?? $shop_currency ) ) );
            if ( $price > 0 && $shop_currency && $currency && $currency !== $shop_currency ) {
                return new WP_Error( 'cdh_supplier_variation_currency_mismatch', __( 'La devise d’une variation fournisseur ne correspond pas à WooCommerce.', 'constello-dropship-hub' ), array( 'status' => 400 ) );
            }
            $stock_raw = array_key_exists( 'stock_qty', $variation ) ? $variation['stock_qty'] : ( $variation['stock'] ?? null );
            $stock_qty = null !== $stock_raw && '' !== $stock_raw && is_numeric( $stock_raw ) ? max( 0, (float) $stock_raw ) : null;
            $available = isset( $variation['available'] ) && null !== $variation['available'] ? (bool) $variation['available'] : null;
            $stock_status = sanitize_key( (string) ( $variation['stock_status'] ?? '' ) );
            if ( ! in_array( $stock_status, array( 'in_stock', 'out_of_stock', 'unknown' ), true ) ) $stock_status = '';
            if ( null !== $stock_qty ) {
                $available = $stock_qty > 0;
                $stock_status = $available ? 'in_stock' : 'out_of_stock';
            } elseif ( '' === $stock_status ) {
                $stock_status = true === $available ? 'in_stock' : ( false === $available ? 'out_of_stock' : 'unknown' );
            }
            $variation_observed_at = sanitize_text_field( (string) ( $variation['observed_at'] ?? $fallback_observed_at ) );
            $out[] = array(
                'supplier_sku_id' => sanitize_text_field( (string) ( $variation['supplier_sku_id'] ?? '' ) ),
                'sku_attr'        => sanitize_text_field( (string) ( $variation['sku_attr'] ?? '' ) ),
                'attributes'      => $attrs,
                'supplier_price'  => array( 'amount' => $price > 0 ? wc_format_decimal( $price ) : '', 'currency' => $currency ),
                // Keep `stock` for backward compatibility; monitoring uses stock_qty/status.
                'stock'           => $stock_qty,
                'stock_qty'       => $stock_qty,
                'stock_status'    => $stock_status,
                'available'       => $available,
                'observed_at'     => $variation_observed_at,
            );
        }
        return $out;
    }

    private static function sanitize_supplier_attributes( $attributes ) {
        if ( ! is_array( $attributes ) ) {
            return array();
        }
        $out = array();
        foreach ( $attributes as $attribute ) {
            if ( ! is_array( $attribute ) ) continue;
            $name  = sanitize_text_field( (string) ( $attribute['name'] ?? '' ) );
            $value = sanitize_text_field( (string) ( $attribute['value'] ?? '' ) );
            if ( '' === $name || '' === $value ) continue;
            $out[] = array(
                'name'         => $name,
                'value'        => $value,
                'source_label' => sanitize_text_field( (string) ( $attribute['source_label'] ?? $name ) ),
                'source_value' => sanitize_text_field( (string) ( $attribute['source_value'] ?? $value ) ),
            );
        }
        return $out;
    }

    /**
     * Variation dimensions and descriptive characteristics intentionally use
     * different WooCommerce flags. A characteristic can never become a
     * variation unless the user explicitly moved it to the variation section
     * in the extension before import.
     */
    private static function apply_attributes( WC_Product $product, $variants, $descriptive_attributes = array() ) {
        $variation_groups = self::variation_groups_for_creation( $variants );
        $attributes = array();
        $position = 0;
        $reserved_names = array();
        foreach ( $variation_groups as $key => $group ) {
            if ( empty( $group['values'] ) ) continue;
            $attribute = new WC_Product_Attribute();
            if ( ( 'global' === $group['target_type'] || 'create_global' === $group['target_type'] ) && ! empty( $group['attribute_id'] ) && ! empty( $group['taxonomy'] ) ) {
                $attribute->set_id( absint( $group['attribute_id'] ) );
                $attribute->set_name( $group['taxonomy'] );
                $attribute->set_options( array_values( array_unique( array_filter( array_map( 'absint', $group['option_ids'] ) ) ) ) );
                $reserved_names[ sanitize_title( $group['taxonomy'] ) ] = true;
                $reserved_names[ sanitize_title( $group['name'] ) ] = true;
            } else {
                $attribute->set_id( 0 );
                $attribute->set_name( $group['name'] );
                $attribute->set_options( array_values( array_map( static function( $item ) { return $item['display']; }, $group['values'] ) ) );
                $reserved_names[ sanitize_title( $group['name'] ) ] = true;
            }
            $attribute->set_position( $position++ );
            $attribute->set_visible( true );
            $attribute->set_variation( true );
            $attributes[] = $attribute;
        }

        foreach ( self::sanitize_supplier_attributes( $descriptive_attributes ) as $item ) {
            $name_key = sanitize_title( $item['name'] );
            if ( '' === $name_key || isset( $reserved_names[ $name_key ] ) ) continue;
            $attribute = new WC_Product_Attribute();
            $attribute->set_id( 0 );
            $attribute->set_name( $item['name'] );
            $attribute->set_options( array( $item['value'] ) );
            $attribute->set_position( $position++ );
            $attribute->set_visible( true );
            $attribute->set_variation( false );
            $attributes[] = $attribute;
            $reserved_names[ $name_key ] = true;
        }
        $product->set_attributes( $attributes );
    }

    private static function resolve_images( $images, $media_ids, $post_id ) {
        $resolved = array();
        foreach ( $images as $index => $image_value ) {
            $media_id = absint( $media_ids[ $index ] ?? 0 );
            if ( $media_id && 'attachment' === get_post_type( $media_id ) && wp_attachment_is_image( $media_id ) && '1' === (string) get_post_meta( $media_id, '_cdh_temp_import_media', true ) ) {
                wp_update_post( array( 'ID' => $media_id, 'post_parent' => $post_id ) );
                delete_post_meta( $media_id, '_cdh_temp_import_media' );
                delete_post_meta( $media_id, '_cdh_temp_media_created_at' );
                $resolved[] = $media_id;
                continue;
            }

            $url = esc_url_raw( (string) $image_value, array( 'https' ) );
            if ( ! $url ) {
                continue;
            }
            $sideloaded = self::sideload_images( array( $url ), $post_id );
            if ( $sideloaded ) {
                $resolved[] = (int) $sideloaded[0];
            }
        }
        return array_values( array_unique( array_filter( array_map( 'absint', $resolved ) ) ) );
    }

    private static function sideload_images( $urls, $post_id ) {
        if ( ! $urls ) return array();
        require_once ABSPATH . 'wp-admin/includes/file.php';
        require_once ABSPATH . 'wp-admin/includes/media.php';
        require_once ABSPATH . 'wp-admin/includes/image.php';

        $ids = array();
        foreach ( $urls as $url ) {
            $url = esc_url_raw( $url, array( 'https' ) );
            if ( ! $url || 0 !== strpos( $url, 'https://' ) || ! wp_http_validate_url( $url ) ) continue;
            $id = media_sideload_image( $url, $post_id, null, 'id' );
            if ( ! is_wp_error( $id ) ) $ids[] = (int) $id;
        }
        return array_values( array_unique( $ids ) );
    }
}
