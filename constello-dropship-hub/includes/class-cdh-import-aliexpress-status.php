<?php
if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

final class CDH_Import_AliExpress_Status {
    const STATUS = 'cdh_aliexpress';

    public static function init() {
        add_action( 'init', array( __CLASS__, 'register_status' ), 20 );
        add_filter( 'views_edit-product', array( __CLASS__, 'place_admin_view_after_private' ), 100 );
        add_action( 'admin_footer-post.php', array( __CLASS__, 'inject_status_in_product_editor' ) );
        add_action( 'admin_footer-post-new.php', array( __CLASS__, 'inject_status_in_product_editor' ) );
    }

    public static function register_status() {
        register_post_status(
            self::STATUS,
            array(
                'label'                     => _x( 'Import AliExpress', 'product status', 'constello-dropship-hub' ),
                'public'                    => false,
                'internal'                  => false,
                'protected'                 => false,
                'private'                   => false,
                'publicly_queryable'        => false,
                'exclude_from_search'       => true,
                'show_in_admin_all_list'    => true,
                'show_in_admin_status_list' => true,
                'label_count'               => _n_noop(
                    'Import AliExpress <span class="count">(%s)</span>',
                    'Import AliExpress <span class="count">(%s)</span>',
                    'constello-dropship-hub'
                ),
            )
        );
    }

    public static function place_admin_view_after_private( $views ) {
        if ( ! is_array( $views ) ) {
            return $views;
        }

        unset( $views[ self::STATUS ] );
        $counts = wp_count_posts( 'product', 'readable' );
        $count  = isset( $counts->{ self::STATUS } ) ? (int) $counts->{ self::STATUS } : 0;

        $current_status = isset( $_GET['post_status'] ) ? sanitize_key( wp_unslash( $_GET['post_status'] ) ) : '';
        $class          = self::STATUS === $current_status ? ' class="current" aria-current="page"' : '';
        $url            = add_query_arg(
            array(
                'post_type'   => 'product',
                'post_status' => self::STATUS,
            ),
            admin_url( 'edit.php' )
        );

        $custom_view = sprintf(
            '<a href="%1$s"%2$s>Import AliExpress <span class="count">(%3$s)</span></a>',
            esc_url( $url ),
            $class,
            esc_html( number_format_i18n( $count ) )
        );

        $result   = array();
        $inserted = false;
        foreach ( $views as $key => $html ) {
            $result[ $key ] = $html;
            if ( 'private' === $key ) {
                $result[ self::STATUS ] = $custom_view;
                $inserted = true;
            }
        }

        if ( ! $inserted ) {
            $result = array();
            foreach ( $views as $key => $html ) {
                $result[ $key ] = $html;
                if ( 'publish' === $key ) {
                    $result[ self::STATUS ] = $custom_view;
                    $inserted = true;
                }
            }
        }

        if ( ! $inserted ) {
            $result[ self::STATUS ] = $custom_view;
        }

        return $result;
    }

    public static function inject_status_in_product_editor() {
        $screen = function_exists( 'get_current_screen' ) ? get_current_screen() : null;
        if ( ! $screen || 'product' !== $screen->post_type ) {
            return;
        }

        global $post;
        $is_current = $post instanceof WP_Post && self::STATUS === $post->post_status;
        ?>
        <script>
        (function () {
            'use strict';
            var select = document.getElementById('post_status');
            if (!select) return;
            if (!select.querySelector('option[value="<?php echo esc_js( self::STATUS ); ?>"]')) {
                var option = document.createElement('option');
                option.value = '<?php echo esc_js( self::STATUS ); ?>';
                option.textContent = 'Import AliExpress';
                select.appendChild(option);
            }
            <?php if ( $is_current ) : ?>
            select.value = '<?php echo esc_js( self::STATUS ); ?>';
            var display = document.getElementById('post-status-display');
            if (display) display.textContent = 'Import AliExpress';
            <?php endif; ?>
        })();
        </script>
        <?php
    }
}
