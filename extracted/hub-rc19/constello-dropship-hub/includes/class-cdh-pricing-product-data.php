<?php
if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

/** Compact pricing view for Constello-imported WooCommerce products. */
final class CDH_Pricing_Product_Data {
    public static function init() {
        add_filter( 'woocommerce_product_data_tabs', array( __CLASS__, 'add_tab' ), 39 );
        add_action( 'woocommerce_product_data_panels', array( __CLASS__, 'render_panel' ) );
        add_action( 'woocommerce_process_product_meta', array( __CLASS__, 'save_panel' ), 19 );
    }

    public static function add_tab( $tabs ) {
        global $post;
        if ( ! $post || 'product' !== $post->post_type || ! get_post_meta( $post->ID, '_cdh_supplier_key', true ) ) return $tabs;
        $product = wc_get_product( $post->ID );
        if ( ! $product || ! $product->is_type( 'variable' ) ) return $tabs;
        $tabs['cdh_pricing'] = array(
            'label'    => __( 'Tarification', 'constello-dropship-hub' ),
            'target'   => 'cdh_pricing_product_data',
            'class'    => array( 'show_if_variable' ),
            'priority' => 64,
        );
        return $tabs;
    }

    public static function render_panel() {
        global $post;
        if ( ! $post || 'product' !== $post->post_type || ! get_post_meta( $post->ID, '_cdh_supplier_key', true ) ) return;
        $product = wc_get_product( $post->ID );
        if ( ! $product || ! $product->is_type( 'variable' ) ) return;

        $currency = get_woocommerce_currency();
        $children = $product->get_children();
        $rule = CDH_Pricing_Rules::get_rule();
        $reprice_url = wp_nonce_url(
            add_query_arg( array( 'action' => CDH_Pricing_Rules::ACTION_REPRICE, 'product_id' => $post->ID ), admin_url( 'admin-post.php' ) ),
            CDH_Pricing_Rules::ACTION_REPRICE . '_' . $post->ID
        );

        echo '<div id="cdh_pricing_product_data" class="panel woocommerce_options_panel hidden">';
        echo '<div class="options_group" style="padding:12px 12px 4px;">';
        echo '<h3 style="margin:0 0 6px;">' . esc_html__( 'Tarification Constello', 'constello-dropship-hub' ) . '</h3>';
        if ( ! empty( $rule['configured'] ) ) {
            echo '<p style="margin:0 0 10px;color:#646970;">' . esc_html( sprintf( __( 'Règle active : %1$s · version %2$d. Les prix automatiques partent toujours du coût SKU fournisseur.', 'constello-dropship-hub' ), $rule['name'], (int) $rule['version'] ) ) . '</p>';
            echo '<p><a class="button button-primary" href="' . esc_url( $reprice_url ) . '">' . esc_html__( 'Recalculer les prix automatiques', 'constello-dropship-hub' ) . '</a> <a class="button" href="' . esc_url( admin_url( 'admin.php?page=' . CDH_Admin_Shell::ROUTE_SETTINGS . '#cdh-pricing-settings' ) ) . '">' . esc_html__( 'Modifier la règle', 'constello-dropship-hub' ) . '</a></p>';
            echo '<p style="color:#646970;margin-top:0;">' . esc_html__( 'Les variations marquées Manuel ne sont jamais écrasées par le recalcul.', 'constello-dropship-hub' ) . '</p>';
        } else {
            echo '<p style="color:#b32d2e;">' . esc_html__( 'Aucune règle de tarification active.', 'constello-dropship-hub' ) . ' <a href="' . esc_url( admin_url( 'admin.php?page=' . CDH_Admin_Shell::ROUTE_SETTINGS . '#cdh-pricing-settings' ) ) . '">' . esc_html__( 'Configurer', 'constello-dropship-hub' ) . '</a></p>';
        }
        echo '</div>';

        echo '<div class="options_group" style="padding:12px;">';
        echo '<table class="widefat striped" style="max-width:1080px;"><thead><tr><th>' . esc_html__( 'Variation', 'constello-dropship-hub' ) . '</th><th style="width:160px;">' . esc_html__( 'Coût fournisseur', 'constello-dropship-hub' ) . '</th><th style="width:190px;">' . esc_html__( 'Prix de vente', 'constello-dropship-hub' ) . '</th><th style="width:105px;">' . esc_html__( 'Marge', 'constello-dropship-hub' ) . '</th><th style="width:100px;">' . esc_html__( 'Mode', 'constello-dropship-hub' ) . '</th></tr></thead><tbody>';
        foreach ( $children as $variation_id ) {
            $variation = wc_get_product( $variation_id );
            if ( ! $variation || ! $variation->is_type( 'variation' ) ) continue;
            $label = wc_get_formatted_variation( $variation, true, false, true );
            if ( '' === trim( wp_strip_all_tags( $label ) ) ) $label = sprintf( __( 'Variation #%d', 'constello-dropship-hub' ), $variation_id );
            $cost = (float) get_post_meta( $variation_id, '_cdh_supplier_price', true );
            $supplier_currency = (string) get_post_meta( $variation_id, '_cdh_supplier_currency', true );
            if ( '' === $supplier_currency ) $supplier_currency = $currency;
            $sale = (float) $variation->get_regular_price( 'edit' );
            $margin = ( $cost > 0 && $sale > 0 ) ? ( ( $sale - $cost ) / $sale ) * 100 : null;
            $manual = (bool) get_post_meta( $variation_id, '_cdh_pricing_manual_override', true );
            $sku = (string) get_post_meta( $variation_id, '_cdh_supplier_sku_id', true );
            echo '<tr><td><strong>' . wp_kses_post( $label ) . '</strong>' . ( $sku ? '<br><small style="color:#646970;">SKU AliExpress ' . esc_html( $sku ) . '</small>' : '' ) . '</td>';
            echo '<td>' . ( $cost > 0 ? esc_html( $supplier_currency . ' ' . wc_format_localized_price( $cost ) ) : '<span style="color:#b32d2e;">' . esc_html__( 'Non détecté', 'constello-dropship-hub' ) . '</span>' ) . '</td>';
            echo '<td><label style="display:flex;align-items:center;gap:7px;"><span>' . esc_html( $currency ) . '</span><input class="cdh-variation-price" data-supplier-cost="' . esc_attr( $cost ) . '" name="cdh_variation_price[' . esc_attr( $variation_id ) . ']" type="number" min="0" step="0.01" value="' . esc_attr( $variation->get_regular_price( 'edit' ) ) . '" style="width:120px;"></label></td>';
            echo '<td><span class="cdh-margin-cell">' . ( null !== $margin ? esc_html( number_format_i18n( $margin, 1 ) . ' %' ) : '—' ) . '</span></td>';
            echo '<td><span style="display:inline-block;padding:3px 7px;border-radius:999px;background:' . ( $manual ? '#fff3cd' : '#e7f7ed' ) . ';color:' . ( $manual ? '#7a5d00' : '#186a3b' ) . ';">' . esc_html( $manual ? __( 'Manuel', 'constello-dropship-hub' ) : __( 'Auto', 'constello-dropship-hub' ) ) . '</span></td></tr>';
        }
        if ( ! $children ) echo '<tr><td colspan="5">' . esc_html__( 'Aucune variation créée.', 'constello-dropship-hub' ) . '</td></tr>';
        echo '</tbody></table></div>';
        echo '<script>(function(){var root=document.getElementById("cdh_pricing_product_data");if(!root)return;root.addEventListener("input",function(e){if(!e.target||!e.target.classList.contains("cdh-variation-price"))return;var el=e.target,cost=parseFloat(el.dataset.supplierCost||0),sale=parseFloat(el.value||0),cell=el.closest("tr").querySelector(".cdh-margin-cell");if(cell)cell.textContent=(cost>0&&sale>0)?(((sale-cost)/sale)*100).toFixed(1)+" %":"—";});})();</script>';
        echo '</div>';
    }

    public static function save_panel( $post_id ) {
        if ( ! current_user_can( 'edit_post', $post_id ) || empty( $_POST['cdh_variation_price'] ) || ! is_array( $_POST['cdh_variation_price'] ) ) return;
        $product = wc_get_product( $post_id );
        if ( ! $product || ! $product->is_type( 'variable' ) || ! get_post_meta( $post_id, '_cdh_supplier_key', true ) ) return;
        $allowed = array_map( 'absint', $product->get_children() );
        $posted = wp_unslash( $_POST['cdh_variation_price'] );
        foreach ( $posted as $variation_id => $value ) {
            $variation_id = absint( $variation_id );
            if ( ! $variation_id || ! in_array( $variation_id, $allowed, true ) ) continue;
            $variation = wc_get_product( $variation_id );
            if ( ! $variation || ! $variation->is_type( 'variation' ) ) continue;
            $new_price = (float) wc_format_decimal( $value );
            if ( ! ( $new_price > 0 ) ) continue;
            $old_price = (float) $variation->get_regular_price( 'edit' );
            if ( abs( $new_price - $old_price ) > 0.00001 ) {
                $variation->set_regular_price( wc_format_decimal( $new_price ) );
                $variation->set_price( wc_format_decimal( $new_price ) );
                $variation->save();
                update_post_meta( $variation_id, '_cdh_pricing_manual_override', '1' );
                update_post_meta( $variation_id, '_cdh_pricing_manual_updated_at', current_time( 'mysql', true ) );
            }
        }
        WC_Product_Variable::sync( $post_id );
        wc_delete_product_transients( $post_id );
        update_post_meta( $post_id, '_cdh_pricing_last_updated', current_time( 'mysql', true ) );
    }
}
