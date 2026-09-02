<?php
if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

/**
 * Adds a dedicated WooCommerce "Fournisseur" product-data tab.
 * Supplier/source metadata stays separate from native merchandising fields.
 */
final class CDH_Supplier_Product_Data {
    public static function init() {
        add_filter( 'woocommerce_product_data_tabs', array( __CLASS__, 'add_tab' ), 40 );
        add_action( 'woocommerce_product_data_panels', array( __CLASS__, 'render_panel' ) );
        add_action( 'woocommerce_process_product_meta', array( __CLASS__, 'save_panel' ), 20 );
    }

    public static function add_tab( $tabs ) {
        global $post;
        if ( ! $post || 'product' !== $post->post_type || ! get_post_meta( $post->ID, '_cdh_supplier_key', true ) ) {
            return $tabs;
        }
        $tabs['cdh_supplier'] = array(
            'label'    => __( 'Fournisseur', 'constello-dropship-hub' ),
            'target'   => 'cdh_supplier_product_data',
            'class'    => array( 'show_if_simple', 'show_if_variable' ),
            'priority' => 65,
        );
        return $tabs;
    }

    private static function meta( $post_id, $key ) {
        return (string) get_post_meta( $post_id, $key, true );
    }

    private static function readonly_row( $label, $value, $extra = '' ) {
        echo '<p class="form-field"><label>' . esc_html( $label ) . '</label><span style="display:inline-flex;min-height:30px;align-items:center;gap:8px;max-width:520px;">';
        echo '<strong style="font-weight:600;">' . esc_html( '' !== $value ? $value : '—' ) . '</strong>';
        if ( $extra ) {
            echo wp_kses_post( $extra );
        }
        echo '</span></p>';
    }

    public static function render_panel() {
        global $post;
        if ( ! $post || 'product' !== $post->post_type ) {
            return;
        }
        $post_id = (int) $post->ID;
        $platform = self::meta( $post_id, '_cdh_supplier_key' );
        $supplier_product_id = self::meta( $post_id, '_cdh_supplier_product_id' );
        $supplier_url = self::meta( $post_id, '_cdh_supplier_url' );
        $store_name = self::meta( $post_id, '_cdh_supplier_store_name' );
        $store_url = self::meta( $post_id, '_cdh_supplier_store_url' );
        $seller_id = self::meta( $post_id, '_cdh_supplier_seller_id' );
        $sold_count = self::meta( $post_id, '_cdh_supplier_sold_count_text' );
        $brand = self::meta( $post_id, '_cdh_supplier_brand' );
        $price = self::meta( $post_id, '_cdh_supplier_base_price' );
        $currency = self::meta( $post_id, '_cdh_supplier_currency' );
        $availability = self::meta( $post_id, '_cdh_supplier_availability' );
        $rating = self::meta( $post_id, '_cdh_supplier_rating_value' );
        $rating_count = self::meta( $post_id, '_cdh_supplier_rating_count' );
        $imported_at = self::meta( $post_id, '_cdh_imported_at' );
        $observed_at = self::meta( $post_id, '_cdh_supplier_observed_at' );
        $supplier_video_url = self::meta( $post_id, '_cdh_supplier_video_url' );
        $video_url = self::meta( $post_id, '_cdh_video_url' );
        $supplier_sku_count = absint( get_post_meta( $post_id, '_cdh_supplier_sku_count', true ) );
        $supplier_stock_qty_count = absint( get_post_meta( $post_id, '_cdh_supplier_stock_qty_count', true ) );
        $supplier_stock_status_count = absint( get_post_meta( $post_id, '_cdh_supplier_stock_status_count', true ) );
        $supplier_out_of_stock_count = absint( get_post_meta( $post_id, '_cdh_supplier_out_of_stock_count', true ) );
        $supplier_sku_observed_at = self::meta( $post_id, '_cdh_supplier_sku_observed_at' );
        $documents_raw = self::meta( $post_id, '_cdh_supplier_documents_v1' ); $documents = $documents_raw ? json_decode( $documents_raw, true ) : array(); if ( ! is_array( $documents ) ) $documents = array();
        $size_guide_raw = self::meta( $post_id, '_cdh_size_guide_v1' ); $size_guide = $size_guide_raw ? json_decode( $size_guide_raw, true ) : array(); if ( ! is_array( $size_guide ) ) $size_guide = array();
        $shipping_raw = self::meta( $post_id, '_cdh_supplier_shipping_current_v1' ); $shipping = $shipping_raw ? json_decode( $shipping_raw, true ) : array(); if ( ! is_array( $shipping ) ) $shipping = array();

        echo '<div id="cdh_supplier_product_data" class="panel woocommerce_options_panel hidden">';
        echo '<div class="options_group">';
        echo '<p style="padding:12px 12px 0;margin:0;color:#646970;">' . esc_html__( 'Source d’approvisionnement liée à ce produit. Ces informations sont séparées des attributs et variations WooCommerce.', 'constello-dropship-hub' ) . '</p>';

        woocommerce_wp_text_input( array(
            'id'          => '_cdh_supplier_store_name',
            'label'       => __( 'Boutique fournisseur', 'constello-dropship-hub' ),
            'value'       => $store_name,
            'desc_tip'    => true,
            'description' => __( 'Nom de la boutique observé lors de l’import.', 'constello-dropship-hub' ),
        ) );
        woocommerce_wp_text_input( array(
            'id'          => '_cdh_supplier_seller_id',
            'label'       => __( 'ID vendeur', 'constello-dropship-hub' ),
            'value'       => $seller_id,
        ) );
        woocommerce_wp_text_input( array(
            'id'          => '_cdh_supplier_product_id',
            'label'       => __( 'ID produit fournisseur', 'constello-dropship-hub' ),
            'value'       => $supplier_product_id,
        ) );
        woocommerce_wp_text_input( array(
            'id'          => '_cdh_supplier_url',
            'label'       => __( 'Lien produit', 'constello-dropship-hub' ),
            'value'       => $supplier_url,
            'type'        => 'url',
        ) );
        woocommerce_wp_text_input( array(
            'id'          => '_cdh_supplier_store_url',
            'label'       => __( 'Lien boutique', 'constello-dropship-hub' ),
            'value'       => $store_url,
            'type'        => 'url',
        ) );
        echo '</div>';

        echo '<div class="options_group">';
        self::readonly_row( __( 'Plateforme', 'constello-dropship-hub' ), $platform ? ucfirst( $platform ) : 'AliExpress' );
        self::readonly_row( __( 'Marque observée', 'constello-dropship-hub' ), $brand );
        self::readonly_row( __( 'Vendus observés', 'constello-dropship-hub' ), $sold_count );
        self::readonly_row( __( 'Prix fournisseur observé', 'constello-dropship-hub' ), trim( $currency . ' ' . $price ) );
        if ( $shipping ) {
            $shipping_label = ! empty( $shipping['fee_known'] ) ? ( ! empty( $shipping['is_free_shipping'] ) ? __( 'Gratuite', 'constello-dropship-hub' ) : trim( (string) ( $shipping['currency'] ?? $currency ) . ' ' . wc_format_decimal( (float) ( $shipping['fee'] ?? 0 ) ) ) ) : __( 'Frais inconnus', 'constello-dropship-hub' );
            if ( null !== ( $shipping['delivery_min_days'] ?? null ) && null !== ( $shipping['delivery_max_days'] ?? null ) ) $shipping_label .= ' · ' . absint( $shipping['delivery_min_days'] ) . '–' . absint( $shipping['delivery_max_days'] ) . ' j';
            self::readonly_row( __( 'Livraison fournisseur', 'constello-dropship-hub' ), $shipping_label );
            if ( null !== ( $shipping['landed_cost'] ?? null ) ) self::readonly_row( __( 'Coût total fournisseur', 'constello-dropship-hub' ), trim( (string) ( $shipping['currency'] ?? $currency ) . ' ' . wc_format_decimal( (float) $shipping['landed_cost'] ) ) );
        }
        self::readonly_row( __( 'Disponibilité observée', 'constello-dropship-hub' ), $availability );
        if ( $supplier_sku_count ) {
            $stock_summary = sprintf( '%1$d/%2$d quantités · %3$d/%2$d statuts', $supplier_stock_qty_count, $supplier_sku_count, $supplier_stock_status_count );
            if ( $supplier_out_of_stock_count ) $stock_summary .= ' · ' . sprintf( _n( '%d rupture', '%d ruptures', $supplier_out_of_stock_count, 'constello-dropship-hub' ), $supplier_out_of_stock_count );
            self::readonly_row( __( 'Stock fournisseur par SKU', 'constello-dropship-hub' ), $stock_summary );
            self::readonly_row( __( 'Observation SKU', 'constello-dropship-hub' ), $supplier_sku_observed_at );
        }
        self::readonly_row( __( 'Note produit', 'constello-dropship-hub' ), $rating ? $rating . '/5' . ( $rating_count ? ' · ' . $rating_count . ' avis' : '' ) : '' );
        self::readonly_row( __( 'Import initial', 'constello-dropship-hub' ), $imported_at );
        self::readonly_row( __( 'Dernière observation', 'constello-dropship-hub' ), $observed_at );
        self::readonly_row( __( 'Vidéo fournisseur', 'constello-dropship-hub' ), $supplier_video_url ? __( 'Détectée', 'constello-dropship-hub' ) : '' );
        self::readonly_row( __( 'Vidéo WordPress', 'constello-dropship-hub' ), $video_url ? __( 'Importée', 'constello-dropship-hub' ) : '' );
        self::readonly_row( __( 'Documents fournisseur', 'constello-dropship-hub' ), $documents ? sprintf( _n( '%d document', '%d documents', count( $documents ), 'constello-dropship-hub' ), count( $documents ) ) : '' );
        self::readonly_row( __( 'Guide des tailles', 'constello-dropship-hub' ), ! empty( $size_guide['sizes'] ) ? sprintf( _n( '%d taille', '%d tailles', count( $size_guide['sizes'] ), 'constello-dropship-hub' ), count( $size_guide['sizes'] ) ) : '' );
        echo '</div>';

        echo '<div class="options_group"><p class="form-field"><label>' . esc_html__( 'Actions', 'constello-dropship-hub' ) . '</label><span style="display:inline-flex;flex-wrap:wrap;gap:8px;">';
        if ( $supplier_url ) {
            echo '<a class="button" target="_blank" rel="noopener noreferrer" href="' . esc_url( $supplier_url ) . '">' . esc_html__( 'Ouvrir le produit fournisseur', 'constello-dropship-hub' ) . '</a>';
        }
        if ( $store_url ) {
            echo '<a class="button" target="_blank" rel="noopener noreferrer" href="' . esc_url( $store_url ) . '">' . esc_html__( 'Ouvrir la boutique', 'constello-dropship-hub' ) . '</a>';
        }
        if ( $video_url ) {
            echo '<a class="button" target="_blank" rel="noopener noreferrer" href="' . esc_url( $video_url ) . '">' . esc_html__( 'Ouvrir la vidéo WordPress', 'constello-dropship-hub' ) . '</a>';
        } elseif ( $supplier_video_url ) {
            echo '<a class="button" target="_blank" rel="noopener noreferrer" href="' . esc_url( $supplier_video_url ) . '">' . esc_html__( 'Ouvrir la vidéo fournisseur', 'constello-dropship-hub' ) . '</a>';
        }
        foreach ( $documents as $document ) { if ( ! is_array( $document ) || empty( $document['url'] ) ) continue; echo '<a class="button" target="_blank" rel="noopener noreferrer" href="' . esc_url( $document['url'] ) . '">' . esc_html( sanitize_text_field( (string) ( $document['title'] ?? __( 'Document PDF', 'constello-dropship-hub' ) ) ) ) . '</a>'; }
        echo '</span></p></div>';
        echo '</div>';
    }

    public static function save_panel( $post_id ) {
        if ( ! current_user_can( 'edit_post', $post_id ) ) {
            return;
        }
        $text_fields = array( '_cdh_supplier_store_name', '_cdh_supplier_seller_id', '_cdh_supplier_product_id' );
        foreach ( $text_fields as $key ) {
            if ( isset( $_POST[ $key ] ) ) {
                update_post_meta( $post_id, $key, sanitize_text_field( wp_unslash( $_POST[ $key ] ) ) );
            }
        }
        foreach ( array( '_cdh_supplier_url', '_cdh_supplier_store_url' ) as $key ) {
            if ( isset( $_POST[ $key ] ) ) {
                update_post_meta( $post_id, $key, esc_url_raw( wp_unslash( $_POST[ $key ] ), array( 'https' ) ) );
            }
        }
    }
}
