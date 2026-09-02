<?php
if ( ! defined( 'ABSPATH' ) ) { exit; }

final class CDH_Product_Extras {
    public static function init() {
        add_filter( 'woocommerce_product_tabs', array( __CLASS__, 'tabs' ), 40 );
    }

    private static function json_meta( $product_id, $key ) {
        $raw = (string) get_post_meta( $product_id, $key, true );
        if ( '' === $raw ) return array();
        $decoded = json_decode( $raw, true );
        return is_array( $decoded ) ? $decoded : array();
    }

    public static function tabs( $tabs ) {
        global $product;
        if ( ! $product instanceof WC_Product ) return $tabs;
        $product_id = $product->get_id();
        $documents = self::json_meta( $product_id, '_cdh_supplier_documents_v1' );
        $visible_documents = array_filter( $documents, static function ( $doc ) { return is_array( $doc ) && ! empty( $doc['url'] ) && ! empty( $doc['import_to_wordpress'] ); } );
        if ( $visible_documents ) {
            $tabs['cdh_documents'] = array(
                'title'    => __( 'Documents', 'constello-dropship-hub' ),
                'priority' => 32,
                'callback' => array( __CLASS__, 'render_documents' ),
            );
        }
        $guide = self::json_meta( $product_id, '_cdh_size_guide_v1' );
        if ( ! empty( $guide['sizes'] ) && is_array( $guide['sizes'] ) ) {
            $tabs['cdh_size_guide'] = array(
                'title'    => __( 'Guide des tailles', 'constello-dropship-hub' ),
                'priority' => 31,
                'callback' => array( __CLASS__, 'render_size_guide' ),
            );
        }
        return $tabs;
    }

    public static function render_documents() {
        global $product;
        if ( ! $product instanceof WC_Product ) return;
        $documents = self::json_meta( $product->get_id(), '_cdh_supplier_documents_v1' );
        echo '<div class="cdh-product-documents">';
        echo '<h2>' . esc_html__( 'Documents du produit', 'constello-dropship-hub' ) . '</h2>';
        echo '<ul style="list-style:none;margin:0;padding:0;display:grid;gap:10px;">';
        foreach ( $documents as $doc ) {
            if ( ! is_array( $doc ) || empty( $doc['url'] ) || empty( $doc['import_to_wordpress'] ) ) continue;
            $title = sanitize_text_field( (string) ( $doc['title'] ?? __( 'Document PDF', 'constello-dropship-hub' ) ) );
            echo '<li><a href="' . esc_url( $doc['url'] ) . '" target="_blank" rel="noopener noreferrer" style="display:inline-flex;align-items:center;gap:8px;font-weight:600;">';
            echo '<span aria-hidden="true">PDF</span><span>' . esc_html( $title ) . '</span></a></li>';
        }
        echo '</ul></div>';
    }

    public static function render_size_guide() {
        global $product;
        if ( ! $product instanceof WC_Product ) return;
        $guide = self::json_meta( $product->get_id(), '_cdh_size_guide_v1' );
        $sizes = is_array( $guide['sizes'] ?? null ) ? $guide['sizes'] : array();
        if ( ! $sizes ) return;
        $columns = array();
        foreach ( $sizes as $size ) {
            foreach ( is_array( $size['measurements'] ?? null ) ? $size['measurements'] : array() as $measurement ) {
                $name = sanitize_text_field( (string) ( $measurement['name'] ?? '' ) );
                if ( $name && ! in_array( $name, $columns, true ) ) $columns[] = $name;
            }
        }
        echo '<div class="cdh-size-guide" style="overflow-x:auto;">';
        echo '<h2>' . esc_html__( 'Guide des tailles', 'constello-dropship-hub' ) . '</h2>';
        echo '<table class="shop_attributes" style="min-width:560px;"><thead><tr><th>' . esc_html( (string) ( $guide['target_attribute'] ?? $guide['source_attribute'] ?? __( 'Taille', 'constello-dropship-hub' ) ) ) . '</th>';
        $attribute_label = (string) ( $guide['target_attribute'] ?? $guide['source_attribute'] ?? __( 'Taille', 'constello-dropship-hub' ) );
        foreach ( $columns as $column ) {
            $display_column = ( sanitize_title( $column ) === sanitize_title( $attribute_label ) && in_array( strtolower( remove_accents( $column ) ), array( 'taille', 'size' ), true ) ) ? __( 'Tour de taille', 'constello-dropship-hub' ) : $column;
            echo '<th>' . esc_html( $display_column ) . '</th>';
        }
        echo '</tr></thead><tbody>';
        foreach ( $sizes as $size ) {
            $measurements = is_array( $size['measurements'] ?? null ) ? $size['measurements'] : array();
            echo '<tr><th>' . esc_html( (string) ( $size['target_value'] ?? $size['source_value'] ?? '—' ) ) . '</th>';
            if ( ! $measurements && $columns ) {
                echo '<td colspan="' . esc_attr( (string) count( $columns ) ) . '">' . esc_html__( 'Mesures non disponibles', 'constello-dropship-hub' ) . '</td>';
                echo '</tr>';
                continue;
            }
            foreach ( $columns as $column ) {
                $value = '—';
                foreach ( $measurements as $measurement ) {
                    if ( sanitize_text_field( (string) ( $measurement['name'] ?? '' ) ) !== $column ) continue;
                    if ( 'range' === (string) ( $measurement['value_type'] ?? '' ) && null !== ( $measurement['min'] ?? null ) && null !== ( $measurement['max'] ?? null ) ) {
                        $value = wc_format_localized_decimal( (float) $measurement['min'] ) . '–' . wc_format_localized_decimal( (float) $measurement['max'] );
                    } elseif ( null !== ( $measurement['value'] ?? null ) && '' !== (string) $measurement['value'] ) {
                        $value = is_numeric( $measurement['value'] ) ? wc_format_localized_decimal( (float) $measurement['value'] ) : (string) $measurement['value'];
                    } else {
                        $value = '—';
                    }
                    if ( '—' !== $value && ! empty( $measurement['unit'] ) ) $value .= ' ' . sanitize_text_field( (string) $measurement['unit'] );
                    if ( ! empty( $measurement['unit_conflict'] ) && ! empty( $measurement['raw_value'] ) ) $value .= ' *';
                    break;
                }
                echo '<td>' . esc_html( $value ) . '</td>';
            }
            echo '</tr>';
        }
        echo '</tbody></table>';
        $has_unit_conflict = false;
        foreach ( $sizes as $size ) {
            foreach ( is_array( $size['measurements'] ?? null ) ? $size['measurements'] : array() as $measurement ) {
                if ( ! empty( $measurement['unit_conflict'] ) ) { $has_unit_conflict = true; break 2; }
            }
        }
        if ( $has_unit_conflict ) echo '<p style="font-size:.9em;opacity:.75;margin-top:8px;">' . esc_html__( '* Unité fournisseur incohérente normalisée par Constello.', 'constello-dropship-hub' ) . '</p>';
        echo '</div>';
    }
}
