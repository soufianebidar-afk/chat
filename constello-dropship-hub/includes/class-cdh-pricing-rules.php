<?php
if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

/**
 * Central pricing engine for Constello Dropship Hub.
 *
 * Supplier prices are captured by the browser extension. Commercial pricing is
 * deliberately evaluated only on WordPress so every browser/user shares the
 * same rule and the rule can evolve without changing the extension.
 */
final class CDH_Pricing_Rules {
    const OPTION_KEY = 'cdh_pricing_rule_v1';
    const ACTION_SAVE = 'cdh_save_pricing_rule';
    const ACTION_REPRICE = 'cdh_reprice_product';
    const MAX_STEPS = 24;

    public static function init() {
        add_action( 'admin_post_' . self::ACTION_SAVE, array( __CLASS__, 'save_rule' ) );
        add_action( 'admin_post_' . self::ACTION_REPRICE, array( __CLASS__, 'reprice_product' ) );
    }

    public static function default_rule() {
        return array(
            'configured' => false,
            'name'       => __( 'Règle par défaut', 'constello-dropship-hub' ),
            'version'    => 0,
            'updated_at' => '',
            'steps'      => array(),
        );
    }

    public static function get_rule() {
        $stored = get_option( self::OPTION_KEY, array() );
        return self::sanitize_rule( is_array( $stored ) ? $stored : array(), false );
    }

    public static function public_summary() {
        $rule = self::get_rule();
        return array(
            'configured' => ! empty( $rule['configured'] ) && ! empty( $rule['steps'] ),
            'name'       => (string) $rule['name'],
            'version'    => (int) $rule['version'],
            'step_count' => count( $rule['steps'] ),
            'updated_at' => (string) $rule['updated_at'],
        );
    }

    private static function allowed_types() {
        return array(
            'multiply',
            'add_fixed',
            'subtract_fixed',
            'add_percent',
            'subtract_percent',
            'target_margin',
            'min_margin',
            'minimum',
            'maximum',
            'psychological',
        );
    }

    private static function sanitize_rule( $raw, $bump_version ) {
        $current = get_option( self::OPTION_KEY, array() );
        $current_version = is_array( $current ) ? absint( $current['version'] ?? 0 ) : 0;
        $name = sanitize_text_field( (string) ( $raw['name'] ?? __( 'Règle par défaut', 'constello-dropship-hub' ) ) );
        if ( '' === $name ) {
            $name = __( 'Règle par défaut', 'constello-dropship-hub' );
        }
        $steps = array();
        foreach ( array_slice( is_array( $raw['steps'] ?? null ) ? $raw['steps'] : array(), 0, self::MAX_STEPS ) as $step ) {
            if ( ! is_array( $step ) ) continue;
            $type = sanitize_key( (string) ( $step['type'] ?? '' ) );
            if ( ! in_array( $type, self::allowed_types(), true ) ) continue;
            $value = (float) ( $step['value'] ?? 0 );
            $enabled = ! array_key_exists( 'enabled', $step ) || ! empty( $step['enabled'] );
            $clean = array(
                'id'      => sanitize_key( (string) ( $step['id'] ?? wp_generate_uuid4() ) ),
                'type'    => $type,
                'value'   => $value,
                'enabled' => $enabled,
            );
            if ( 'psychological' === $type ) {
                $suffix = (float) ( $step['suffix'] ?? 0.90 );
                $allowed_suffixes = array( 0.00, 0.50, 0.90, 0.95, 0.99 );
                $closest = 0.90;
                $distance = PHP_FLOAT_MAX;
                foreach ( $allowed_suffixes as $candidate ) {
                    $d = abs( $suffix - $candidate );
                    if ( $d < $distance ) { $closest = $candidate; $distance = $d; }
                }
                $mode = sanitize_key( (string) ( $step['mode'] ?? 'nearest' ) );
                if ( ! in_array( $mode, array( 'nearest', 'up', 'down' ), true ) ) $mode = 'nearest';
                $clean['suffix'] = $closest;
                $clean['mode']   = $mode;
            }
            $steps[] = $clean;
        }
        $configured = ! empty( $steps ) && ! empty( $raw['configured'] );
        return array(
            'configured' => $configured,
            'name'       => $name,
            'version'    => $bump_version ? max( 1, $current_version + 1 ) : absint( $raw['version'] ?? $current_version ),
            'updated_at' => $bump_version ? current_time( 'mysql', true ) : sanitize_text_field( (string) ( $raw['updated_at'] ?? '' ) ),
            'steps'      => $steps,
        );
    }

    public static function save_rule() {
        if ( ! current_user_can( 'manage_woocommerce' ) ) {
            wp_die( esc_html__( 'Accès refusé.', 'constello-dropship-hub' ) );
        }
        check_admin_referer( self::ACTION_SAVE );
        $json = isset( $_POST['cdh_pricing_rule_json'] ) ? wp_unslash( $_POST['cdh_pricing_rule_json'] ) : '';
        $decoded = json_decode( (string) $json, true );
        if ( ! is_array( $decoded ) ) {
            wp_safe_redirect( add_query_arg( array( 'page' => CDH_Admin_Shell::ROUTE_SETTINGS, 'cdh_pricing_error' => 'invalid_json' ), admin_url( 'admin.php' ) ) );
            exit;
        }
        $decoded['configured'] = true;
        $clean = self::sanitize_rule( $decoded, true );
        if ( empty( $clean['steps'] ) ) {
            wp_safe_redirect( add_query_arg( array( 'page' => CDH_Admin_Shell::ROUTE_SETTINGS, 'cdh_pricing_error' => 'no_steps' ), admin_url( 'admin.php' ) ) );
            exit;
        }
        update_option( self::OPTION_KEY, $clean, false );
        wp_safe_redirect( add_query_arg( array( 'page' => CDH_Admin_Shell::ROUTE_SETTINGS, 'cdh_pricing_saved' => '1' ), admin_url( 'admin.php' ) ) );
        exit;
    }

    /**
     * Evaluate one supplier cost through the active ordered pipeline.
     * Returns both raw/final values and a trace suitable for auditing.
     */
    public static function calculate( $supplier_cost, $rule = null ) {
        $supplier_cost = (float) $supplier_cost;
        if ( ! ( $supplier_cost > 0 ) ) {
            return new WP_Error( 'cdh_invalid_supplier_cost', __( 'Prix fournisseur invalide pour la tarification.', 'constello-dropship-hub' ) );
        }
        if ( null === $rule ) $rule = self::get_rule();
        if ( empty( $rule['configured'] ) || empty( $rule['steps'] ) ) {
            return new WP_Error( 'cdh_pricing_rule_missing', __( 'Aucune règle de tarification active. Configure Dropship Hub → Réglages → Tarification.', 'constello-dropship-hub' ) );
        }
        $value = $supplier_cost;
        $trace = array();
        foreach ( $rule['steps'] as $index => $step ) {
            if ( empty( $step['enabled'] ) ) continue;
            $before = $value;
            $amount = (float) ( $step['value'] ?? 0 );
            switch ( $step['type'] ) {
                case 'multiply':
                    if ( $amount > 0 ) $value *= $amount;
                    break;
                case 'add_fixed':
                    $value += $amount;
                    break;
                case 'subtract_fixed':
                    $value -= $amount;
                    break;
                case 'add_percent':
                    $value *= ( 1 + ( $amount / 100 ) );
                    break;
                case 'subtract_percent':
                    $value *= ( 1 - ( $amount / 100 ) );
                    break;
                case 'target_margin':
                    if ( $amount > 0 && $amount < 100 ) $value = $supplier_cost / ( 1 - ( $amount / 100 ) );
                    break;
                case 'min_margin':
                    if ( $amount > 0 && $amount < 100 ) {
                        $minimum_sale = $supplier_cost / ( 1 - ( $amount / 100 ) );
                        $value = max( $value, $minimum_sale );
                    }
                    break;
                case 'minimum':
                    if ( $amount > 0 ) $value = max( $value, $amount );
                    break;
                case 'maximum':
                    if ( $amount > 0 ) $value = min( $value, $amount );
                    break;
                case 'psychological':
                    $value = self::psychological_price( $value, (float) ( $step['suffix'] ?? 0.90 ), (string) ( $step['mode'] ?? 'nearest' ) );
                    break;
            }
            $value = max( 0.0, $value );
            $trace[] = array(
                'index'  => (int) $index,
                'type'   => (string) $step['type'],
                'before' => round( $before, 6 ),
                'after'  => round( $value, 6 ),
                'value'  => $amount,
                'suffix' => isset( $step['suffix'] ) ? (float) $step['suffix'] : null,
                'mode'   => isset( $step['mode'] ) ? (string) $step['mode'] : null,
            );
        }
        if ( ! ( $value > 0 ) ) {
            return new WP_Error( 'cdh_pricing_result_invalid', __( 'La règle de tarification produit un prix nul ou négatif.', 'constello-dropship-hub' ) );
        }
        $final = round( $value, function_exists( 'wc_get_price_decimals' ) ? wc_get_price_decimals() : 2 );
        $margin = $final > 0 ? ( ( $final - $supplier_cost ) / $final ) * 100 : null;
        return array(
            'supplier_cost' => $supplier_cost,
            'raw_price'     => $value,
            'final_price'   => $final,
            'margin_percent'=> null !== $margin ? round( $margin, 2 ) : null,
            'trace'         => $trace,
            'rule_name'     => (string) $rule['name'],
            'rule_version'  => (int) $rule['version'],
        );
    }

    public static function psychological_price( $price, $suffix, $mode ) {
        $price = max( 0.0, (float) $price );
        $suffix = max( 0.0, min( 0.99, (float) $suffix ) );
        $floor = floor( $price );
        $same = $floor + $suffix;
        $previous = max( 0.0, $floor - 1 + $suffix );
        $next = $floor + 1 + $suffix;
        if ( 'up' === $mode ) return $price <= $same ? $same : $next;
        if ( 'down' === $mode ) return $price >= $same ? $same : $previous;
        $candidates = array_unique( array( $previous, $same, $next ) );
        $best = $same;
        $best_distance = PHP_FLOAT_MAX;
        foreach ( $candidates as $candidate ) {
            if ( $candidate < 0 ) continue;
            $distance = abs( $price - $candidate );
            if ( $distance < $best_distance ) {
                $best = $candidate;
                $best_distance = $distance;
            } elseif ( abs( $distance - $best_distance ) < 0.000001 && $candidate > $best ) {
                // Stable tie-breaker: prefer the higher psychological price.
                $best = $candidate;
            }
        }
        return $best;
    }

    /** Build server-authoritative prices from raw supplier SKU prices. */
    public static function build_import_pricing( $supplier_variations, $base_supplier_price, $has_variants, $currency ) {
        $rule = self::get_rule();
        if ( empty( $rule['configured'] ) || empty( $rule['steps'] ) ) {
            return new WP_Error( 'cdh_pricing_rule_missing', __( 'Configure une règle de tarification dans Constello Dropship Hub avant d’importer.', 'constello-dropship-hub' ), array( 'status' => 422 ) );
        }
        $currency = strtoupper( sanitize_text_field( (string) $currency ) );
        $base_calc = self::calculate( $base_supplier_price, $rule );
        if ( is_wp_error( $base_calc ) ) {
            $base_calc->add_data( array( 'status' => 422 ) );
            return $base_calc;
        }
        $combinations = array();
        if ( $has_variants ) {
            if ( ! is_array( $supplier_variations ) || empty( $supplier_variations ) ) {
                return new WP_Error( 'cdh_supplier_sku_matrix_missing', __( 'Les combinaisons SKU/prix fournisseur réelles ne sont pas disponibles.', 'constello-dropship-hub' ), array( 'status' => 422 ) );
            }
            $seen = array();
            foreach ( $supplier_variations as $variation ) {
                if ( ! is_array( $variation ) ) continue;
                $sku = sanitize_text_field( (string) ( $variation['supplier_sku_id'] ?? '' ) );
                $price_obj = is_array( $variation['supplier_price'] ?? null ) ? $variation['supplier_price'] : array();
                $cost = (float) ( $price_obj['amount'] ?? 0 );
                $supplier_currency = strtoupper( sanitize_text_field( (string) ( $price_obj['currency'] ?? $currency ) ) );
                if ( '' === $sku || ! ( $cost > 0 ) ) {
                    return new WP_Error( 'cdh_supplier_sku_price_missing', __( 'Un SKU fournisseur ou son prix réel manque. La création des variations est bloquée.', 'constello-dropship-hub' ), array( 'status' => 422 ) );
                }
                if ( $supplier_currency && $currency && $supplier_currency !== $currency ) {
                    return new WP_Error( 'cdh_supplier_variation_currency_mismatch', __( 'La devise d’un SKU fournisseur ne correspond pas à WooCommerce.', 'constello-dropship-hub' ), array( 'status' => 422 ) );
                }
                $attrs = is_array( $variation['attributes'] ?? null ) ? $variation['attributes'] : array();
                $signature = wp_json_encode( array_map( static function( $a ) {
                    return array( 'name' => sanitize_text_field( (string) ( $a['name'] ?? '' ) ), 'value' => sanitize_text_field( (string) ( $a['value'] ?? '' ) ) );
                }, $attrs ) );
                if ( isset( $seen[ $signature ] ) ) {
                    return new WP_Error( 'cdh_supplier_sku_ambiguous', __( 'Deux SKU fournisseur correspondent à la même combinaison après édition des variantes.', 'constello-dropship-hub' ), array( 'status' => 422 ) );
                }
                $seen[ $signature ] = true;
                $calc = self::calculate( $cost, $rule );
                if ( is_wp_error( $calc ) ) {
                    $calc->add_data( array( 'status' => 422 ) );
                    return $calc;
                }
                $combinations[] = array(
                    'attributes'             => $attrs,
                    'supplier_sku_id'        => $sku,
                    'sku_attr'               => sanitize_text_field( (string) ( $variation['sku_attr'] ?? '' ) ),
                    'supplier_price'         => $cost,
                    'supplier_regular_price' => $cost,
                    'supplier_currency'      => $supplier_currency ?: $currency,
                    'supplier_stock'         => array_key_exists( 'stock_qty', $variation ) && null !== $variation['stock_qty'] ? (float) $variation['stock_qty'] : ( isset( $variation['stock'] ) && null !== $variation['stock'] ? (float) $variation['stock'] : null ),
                    'supplier_stock_qty'     => array_key_exists( 'stock_qty', $variation ) && null !== $variation['stock_qty'] ? (float) $variation['stock_qty'] : ( isset( $variation['stock'] ) && null !== $variation['stock'] ? (float) $variation['stock'] : null ),
                    'supplier_stock_status'  => sanitize_key( (string) ( $variation['stock_status'] ?? 'unknown' ) ),
                    'supplier_available'     => isset( $variation['available'] ) && null !== $variation['available'] ? (bool) $variation['available'] : null,
                    'supplier_observed_at'   => sanitize_text_field( (string) ( $variation['observed_at'] ?? '' ) ),
                    'regular_price'          => (float) $calc['final_price'],
                    'raw_calculated_price'   => (float) $calc['raw_price'],
                    'margin_percent'         => $calc['margin_percent'],
                    'pricing_trace'          => $calc['trace'],
                    'pricing_rule_name'      => $calc['rule_name'],
                    'pricing_rule_version'   => $calc['rule_version'],
                );
            }
        }
        return array(
            'currency'           => $currency,
            'base_regular_price' => (float) $base_calc['final_price'],
            'base_supplier_cost' => (float) $base_supplier_price,
            'method'             => 'wordpress_rule',
            'rule_name'          => (string) $rule['name'],
            'rule_version'       => (int) $rule['version'],
            'steps'              => $rule['steps'],
            'combinations'       => $combinations,
            'combination_count'  => count( $combinations ),
        );
    }

    /** Recalculate an already-imported product using the active rule, preserving manual overrides. */
    public static function reprice_product() {
        $product_id = isset( $_GET['product_id'] ) ? absint( $_GET['product_id'] ) : 0;
        if ( ! $product_id || ! current_user_can( 'edit_post', $product_id ) ) wp_die( esc_html__( 'Accès refusé.', 'constello-dropship-hub' ) );
        check_admin_referer( self::ACTION_REPRICE . '_' . $product_id );
        $product = wc_get_product( $product_id );
        if ( ! $product || ! get_post_meta( $product_id, '_cdh_supplier_key', true ) ) wp_die( esc_html__( 'Produit Constello introuvable.', 'constello-dropship-hub' ) );
        $rule = self::get_rule();
        $updated = 0;
        if ( $product->is_type( 'variable' ) ) {
            foreach ( $product->get_children() as $variation_id ) {
                if ( get_post_meta( $variation_id, '_cdh_pricing_manual_override', true ) ) continue;
                $cost = (float) get_post_meta( $variation_id, '_cdh_supplier_price', true );
                if ( ! ( $cost > 0 ) ) continue;
                $calc = self::calculate( $cost, $rule );
                if ( is_wp_error( $calc ) ) continue;
                $variation = wc_get_product( $variation_id );
                if ( ! $variation ) continue;
                $variation->set_regular_price( wc_format_decimal( $calc['final_price'] ) );
                $variation->set_price( wc_format_decimal( $calc['final_price'] ) );
                $variation->save();
                update_post_meta( $variation_id, '_cdh_pricing_rule_name', $calc['rule_name'] );
                update_post_meta( $variation_id, '_cdh_pricing_rule_version', $calc['rule_version'] );
                update_post_meta( $variation_id, '_cdh_pricing_trace', wp_json_encode( $calc['trace'] ) );
                $updated++;
            }
            WC_Product_Variable::sync( $product_id );
        } else {
            if ( ! get_post_meta( $product_id, '_cdh_pricing_manual_override', true ) ) {
                $cost = (float) get_post_meta( $product_id, '_cdh_supplier_base_price', true );
                if ( $cost > 0 ) {
                    $calc = self::calculate( $cost, $rule );
                    if ( ! is_wp_error( $calc ) ) {
                        $product->set_regular_price( wc_format_decimal( $calc['final_price'] ) );
                        $product->set_price( wc_format_decimal( $calc['final_price'] ) );
                        $product->save();
                        $updated = 1;
                    }
                }
            }
        }
        wc_delete_product_transients( $product_id );
        wp_safe_redirect( add_query_arg( array( 'post' => $product_id, 'action' => 'edit', 'cdh_repriced' => $updated ), admin_url( 'post.php' ) ) );
        exit;
    }
}
