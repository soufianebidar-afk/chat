<?php
if ( ! defined( 'ABSPATH' ) ) { exit; }

final class CDH_Catalog_Settings {
    const OPTION_EXTRACTION = 'cdh_extraction_settings_v1';
    const OPTION_MAPPINGS   = 'cdh_attribute_mappings_v1';
    const ACTION_SAVE_EXTRACTION = 'cdh_save_extraction_settings';
    const ACTION_RESET_MAPPINGS  = 'cdh_reset_attribute_mappings';

    public static function init() {
        add_action( 'admin_post_' . self::ACTION_SAVE_EXTRACTION, array( __CLASS__, 'save_extraction_settings' ) );
        add_action( 'admin_post_' . self::ACTION_RESET_MAPPINGS, array( __CLASS__, 'reset_mappings' ) );
    }

    public static function fields() {
        return array(
            'images'          => __( 'Images', 'constello-dropship-hub' ),
            'video'           => __( 'Vidéo', 'constello-dropship-hub' ),
            'documents'       => __( 'Documents produit (PDF)', 'constello-dropship-hub' ),
            'size_guide'      => __( 'Guide des tailles', 'constello-dropship-hub' ),
            'shipping'        => __( 'Livraison fournisseur', 'constello-dropship-hub' ),
            'description'     => __( 'Description', 'constello-dropship-hub' ),
            'variants'        => __( 'Variantes et SKU', 'constello-dropship-hub' ),
            'characteristics' => __( 'Caractéristiques', 'constello-dropship-hub' ),
            'brand'           => __( 'Marque', 'constello-dropship-hub' ),
            'availability'    => __( 'Disponibilité', 'constello-dropship-hub' ),
            'rating'          => __( 'Note et avis', 'constello-dropship-hub' ),
            'supplier_store'  => __( 'Boutique fournisseur', 'constello-dropship-hub' ),
            'sales'           => __( 'Nombre de ventes', 'constello-dropship-hub' ),
        );
    }

    public static function presets() {
        $all = array_fill_keys( array_keys( self::fields() ), true );
        $essential = array_fill_keys( array_keys( self::fields() ), false );
        foreach ( array( 'images', 'variants', 'brand', 'supplier_store' ) as $key ) $essential[ $key ] = true;
        $standard = $all;
        $standard['sales'] = false;
        return array(
            'essential' => $essential,
            'standard'  => $standard,
            'complete'  => $all,
        );
    }

    public static function get_extraction_settings() {
        $stored = get_option( self::OPTION_EXTRACTION, array() );
        $preset = self::presets()['standard'];
        if ( ! is_array( $stored ) ) $stored = array();
        $out = array( 'profile' => sanitize_key( (string) ( $stored['profile'] ?? 'standard' ) ) );
        foreach ( self::fields() as $key => $label ) $out[ $key ] = array_key_exists( $key, $stored ) ? (bool) $stored[ $key ] : (bool) $preset[ $key ];
        return $out;
    }

    public static function save_extraction_settings() {
        if ( ! current_user_can( 'manage_woocommerce' ) ) wp_die( esc_html__( 'Accès refusé.', 'constello-dropship-hub' ) );
        check_admin_referer( self::ACTION_SAVE_EXTRACTION );
        $profile = isset( $_POST['cdh_extraction_profile'] ) ? sanitize_key( wp_unslash( $_POST['cdh_extraction_profile'] ) ) : 'custom';
        if ( ! in_array( $profile, array( 'essential', 'standard', 'complete', 'custom' ), true ) ) $profile = 'custom';
        $settings = array( 'profile' => $profile );
        foreach ( self::fields() as $key => $label ) $settings[ $key ] = isset( $_POST[ 'cdh_extract_' . $key ] );
        update_option( self::OPTION_EXTRACTION, $settings, false );
        wp_safe_redirect( add_query_arg( array( 'page' => CDH_Admin_Shell::ROUTE_SETTINGS, 'cdh_extraction_saved' => '1' ), admin_url( 'admin.php' ) ) );
        exit;
    }

    public static function get_mappings() {
        $stored = get_option( self::OPTION_MAPPINGS, array() );
        return is_array( $stored ) ? $stored : array();
    }

    private static function source_key( $label ) {
        return sanitize_title( remove_accents( (string) $label ) );
    }

    public static function save_mapping( $mapping ) {
        if ( ! is_array( $mapping ) ) return new WP_Error( 'cdh_invalid_mapping', __( 'Correspondance invalide.', 'constello-dropship-hub' ), array( 'status' => 400 ) );
        $source_label = sanitize_text_field( (string) ( $mapping['source_label'] ?? '' ) );
        if ( '' === $source_label ) return new WP_Error( 'cdh_mapping_source_required', __( 'Nom d’attribut fournisseur requis.', 'constello-dropship-hub' ), array( 'status' => 400 ) );
        $target_type = sanitize_key( (string) ( $mapping['target_type'] ?? 'product' ) );
        if ( ! in_array( $target_type, array( 'global', 'create_global', 'product' ), true ) ) $target_type = 'product';
        $target_name = sanitize_text_field( (string) ( $mapping['target_name'] ?? $source_label ) );
        $attribute_id = absint( $mapping['attribute_id'] ?? 0 );
        $taxonomy = sanitize_key( (string) ( $mapping['taxonomy'] ?? '' ) );
        $value_map = array();
        foreach ( is_array( $mapping['value_map'] ?? null ) ? $mapping['value_map'] : array() as $entry ) {
            if ( ! is_array( $entry ) ) continue;
            $source = sanitize_text_field( (string) ( $entry['source'] ?? '' ) );
            $target = sanitize_text_field( (string) ( $entry['target'] ?? '' ) );
            if ( '' === $source || '' === $target ) continue;
            $value_map[ self::source_key( $source ) ] = array( 'source' => $source, 'target' => $target );
        }
        $mappings = self::get_mappings();
        $key = self::source_key( $source_label );
        $mappings[ $key ] = array(
            'source_label' => $source_label,
            'target_type' => $target_type,
            'attribute_id' => $attribute_id,
            'taxonomy' => $taxonomy,
            'target_name' => $target_name ?: $source_label,
            'value_map' => $value_map,
            'updated_at' => current_time( 'mysql', true ),
        );
        update_option( self::OPTION_MAPPINGS, $mappings, false );
        return $mappings[ $key ];
    }

    public static function learn_from_variants( $variants ) {
        if ( ! is_array( $variants ) ) return;
        $mappings = self::get_mappings();
        foreach ( $variants as $variant ) {
            if ( ! is_array( $variant ) ) continue;
            $source_label = sanitize_text_field( (string) ( $variant['source_dimension_label'] ?? $variant['dimension_label'] ?? '' ) );
            if ( '' === $source_label ) continue;
            $key = self::source_key( $source_label );
            if ( '' === $key ) continue;
            $target_type = sanitize_key( (string) ( $variant['target_attribute_type'] ?? 'product' ) );
            if ( ! in_array( $target_type, array( 'global', 'create_global', 'product' ), true ) ) $target_type = 'product';
            $target_name = sanitize_text_field( (string) ( $variant['target_attribute_name'] ?? $variant['dimension_label'] ?? $source_label ) );
            $resolved_id = absint( $variant['target_attribute_id'] ?? 0 );
            $resolved_taxonomy = sanitize_key( (string) ( $variant['target_attribute_taxonomy'] ?? '' ) );
            if ( 'create_global' === $target_type && function_exists( 'wc_get_attribute_taxonomies' ) ) {
                foreach ( wc_get_attribute_taxonomies() as $attr ) {
                    $candidate = (string) ( $attr->attribute_label ?? $attr->attribute_name ?? '' );
                    if ( sanitize_title( $candidate ) === sanitize_title( $target_name ) ) {
                        $resolved_id = absint( $attr->attribute_id ?? 0 );
                        $resolved_taxonomy = function_exists( 'wc_attribute_taxonomy_name' ) ? wc_attribute_taxonomy_name( (string) $attr->attribute_name ) : 'pa_' . sanitize_title( (string) $attr->attribute_name );
                        $target_type = 'global';
                        break;
                    }
                }
            }
            $current = isset( $mappings[ $key ] ) && is_array( $mappings[ $key ] ) ? $mappings[ $key ] : array();
            $value_map = isset( $current['value_map'] ) && is_array( $current['value_map'] ) ? $current['value_map'] : array();
            $source_value = sanitize_text_field( (string) ( $variant['source_label_raw'] ?? $variant['label_raw'] ?? '' ) );
            $target_value = sanitize_text_field( (string) ( $variant['label_raw'] ?? '' ) );
            if ( '' !== $source_value && '' !== $target_value ) $value_map[ self::source_key( $source_value ) ] = array( 'source' => $source_value, 'target' => $target_value );
            $mappings[ $key ] = array(
                'source_label'        => $source_label,
                'target_type'         => $target_type,
                'attribute_id'        => $resolved_id,
                'taxonomy'            => $resolved_taxonomy,
                'target_name'         => $target_name,
                'value_map'           => $value_map,
                'updated_at'          => current_time( 'mysql', true ),
            );
        }
        update_option( self::OPTION_MAPPINGS, $mappings, false );
    }

    public static function reset_mappings() {
        if ( ! current_user_can( 'manage_woocommerce' ) ) wp_die( esc_html__( 'Accès refusé.', 'constello-dropship-hub' ) );
        check_admin_referer( self::ACTION_RESET_MAPPINGS );
        delete_option( self::OPTION_MAPPINGS );
        wp_safe_redirect( add_query_arg( array( 'page' => CDH_Admin_Shell::ROUTE_SETTINGS, 'cdh_mappings_reset' => '1' ), admin_url( 'admin.php' ) ) );
        exit;
    }

    public static function attribute_catalog() {
        if ( ! function_exists( 'wc_get_attribute_taxonomies' ) ) return array();
        $out = array();
        foreach ( wc_get_attribute_taxonomies() as $attr ) {
            $id = absint( $attr->attribute_id ?? 0 );
            $name = sanitize_text_field( (string) ( $attr->attribute_label ?? $attr->attribute_name ?? '' ) );
            $taxonomy = function_exists( 'wc_attribute_taxonomy_name' ) ? wc_attribute_taxonomy_name( (string) ( $attr->attribute_name ?? '' ) ) : 'pa_' . sanitize_title( (string) ( $attr->attribute_name ?? '' ) );
            $terms = array();
            if ( taxonomy_exists( $taxonomy ) ) {
                $found = get_terms( array( 'taxonomy' => $taxonomy, 'hide_empty' => false, 'number' => 200 ) );
                if ( ! is_wp_error( $found ) ) foreach ( $found as $term ) $terms[] = array( 'id' => (int) $term->term_id, 'name' => (string) $term->name, 'slug' => (string) $term->slug );
            }
            $out[] = array( 'id' => $id, 'name' => $name, 'taxonomy' => $taxonomy, 'terms' => $terms );
        }
        return $out;
    }

    public static function public_config() {
        return array(
            'extraction'         => self::get_extraction_settings(),
            'attribute_catalog'  => self::attribute_catalog(),
            'attribute_mappings' => array_values( self::get_mappings() ),
        );
    }
}
