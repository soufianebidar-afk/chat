<?php
$root = dirname( __DIR__ );
$required = array(
    'constello-dropship-hub.php',
    'includes/class-constello-admin-shell.php',
    'includes/class-cdh-admin-shell.php',
    'includes/class-cdh-rest-api.php',
    'includes/class-cdh-temp-media-guard.php',
    'includes/class-cdh-catalog-settings.php',
    'includes/class-cdh-supplier-product-data.php',
    'includes/class-cdh-product-extras.php',
    'includes/class-cdh-pricing-rules.php',
    'includes/class-cdh-pricing-product-data.php',
    'includes/class-cdh-import-aliexpress-status.php',
    'assets/constello-shell.css', 'assets/constello-shell.js', 'assets/constello-mark-hexagon.svg', 'assets/admin.css',
);
foreach ( $required as $path ) {
    if ( ! is_file( $root . '/' . $path ) ) { fwrite( STDERR, "FAIL missing $path\n" ); exit( 1 ); }
}
$main = file_get_contents( $root . '/constello-dropship-hub.php' );
$app = file_get_contents( $root . '/includes/class-cdh-admin-shell.php' );
$shell = file_get_contents( $root . '/includes/class-constello-admin-shell.php' );
$status = file_get_contents( $root . '/includes/class-cdh-import-aliexpress-status.php' );
$api = file_get_contents( $root . '/includes/class-cdh-rest-api.php' );
$guard = file_get_contents( $root . '/includes/class-cdh-temp-media-guard.php' );
$supplier = file_get_contents( $root . '/includes/class-cdh-supplier-product-data.php' );
$extras = file_get_contents( $root . '/includes/class-cdh-product-extras.php' );
$pricing = file_get_contents( $root . '/includes/class-cdh-pricing-product-data.php' );
$rules = file_get_contents( $root . '/includes/class-cdh-pricing-rules.php' );
$catalog = file_get_contents( $root . '/includes/class-cdh-catalog-settings.php' );
$css = file_get_contents( $root . '/assets/constello-shell.css' );
$import_start = strpos( $api, 'public static function import_product' );
$import_identity = false !== $import_start ? strpos( $api, '$supplier_product_id = sanitize_text_field', $import_start ) : false;
$import_video_validation = false !== $import_start ? strpos( $api, 'cdh_video_media_required', $import_start ) : false;
$identity_persist = false !== $import_start ? strpos( $api, "update_post_meta( \$post_id, '_cdh_supplier_key'", $import_start ) : false;
$product_enrichment = false !== $import_start ? strpos( $api, 'new WC_Product_Variable', $import_start ) : false;
$checks = array(
    'plugin name' => strpos( $main, 'Plugin Name: Constello Dropship Hub' ) !== false,
    'rc20 media guard version' => strpos( $main, '1.0.0-rc20-media-guard' ) !== false,
    'rc20 media guard loaded' => strpos( $main, 'class-cdh-temp-media-guard.php' ) !== false && strpos( $main, 'CDH_Temp_Media_Guard::init()' ) !== false,
    'pricing engine loaded' => strpos( $main, 'class-cdh-pricing-rules.php' ) !== false && strpos( $main, 'CDH_Pricing_Rules::init()' ) !== false,
    'RC129 shell' => strpos( $shell, "const PARENT_SLUG = 'constello-app'" ) !== false && strpos( $css, 'background-color:currentColor' ) !== false,
    'registry app' => strpos( $app, "add_filter( 'constello_admin_apps'" ) !== false && strpos( $app, 'Constello_Admin_Shell::app_header' ) !== false,
    'pricing settings builder' => strpos( $app, 'cdh-pricing-settings' ) !== false && strpos( $app, 'Ajouter une étape' ) !== false && strpos( $app, 'Prix SKU fournisseur' ) !== false,
    'pricing pipeline operations' => strpos( $rules, "'multiply'" ) !== false && strpos( $rules, "'add_fixed'" ) !== false && strpos( $rules, "'add_percent'" ) !== false && strpos( $rules, "'psychological'" ) !== false,
    'pricing versioned' => strpos( $rules, "'version'" ) !== false && strpos( $rules, 'current_version + 1' ) !== false,
    'server authoritative import pricing' => strpos( $api, 'CDH_Pricing_Rules::build_import_pricing' ) !== false,
    'config exposes pricing' => strpos( $api, "'pricing'" ) !== false && strpos( $api, 'CDH_Pricing_Rules::public_summary' ) !== false,
    'config exposes extraction and catalog' => strpos( $api, 'CDH_Catalog_Settings::public_config' ) !== false && strpos( $catalog, 'attribute_catalog' ) !== false && strpos( $catalog, 'attribute_mappings' ) !== false,
    'extraction profiles available' => strpos( $catalog, "'essential'") !== false && strpos( $catalog, "'standard'") !== false && strpos( $catalog, "'complete'") !== false,
    'catalog mappings learned on import' => strpos( $api, 'CDH_Catalog_Settings::learn_from_variants' ) !== false,
    'video import endpoint' => strpos( $api, "'/import-video'" ) !== false && strpos( $api, 'function import_video' ) !== false && strpos( $api, '_cdh_temp_import_video' ) !== false,
    'video attached to product' => strpos( $api, '_cdh_video_attachment_id' ) !== false && strpos( $api, '_cdh_supplier_video_url' ) !== false && strpos( $api, 'add_to_description' ) !== false,
    'PDF document import endpoint' => strpos( $api, "'/import-document'" ) !== false && strpos( $api, 'function import_document' ) !== false && strpos( $api, '_cdh_temp_import_document' ) !== false,
    'documents attached and stored' => strpos( $api, '_cdh_supplier_documents_v1' ) !== false && strpos( $api, '_cdh_document_attachment_ids' ) !== false,
    'size guide stored' => strpos( $api, '_cdh_size_guide_v1' ) !== false && strpos( $api, 'sanitize_size_guide' ) !== false,
    'product extras tabs' => strpos( $extras, 'Guide des tailles' ) !== false && strpos( $extras, 'Documents du produit' ) !== false,
    'extraction profiles include documents and size guide' => strpos( $catalog, "'documents'" ) !== false && strpos( $catalog, "'size_guide'" ) !== false,
    'extraction profile includes supplier shipping' => strpos( $catalog, "'shipping'" ) !== false,
    'supplier shipping snapshot stored separately' => strpos( $api, '_cdh_supplier_shipping_current_v1' ) !== false && strpos( $api, '_cdh_supplier_shipping_snapshot_v1' ) !== false && strpos( $api, '_cdh_supplier_shipping_baseline_v1' ) !== false,
    'supplier landed cost prepared without pricing mutation' => strpos( $api, '_cdh_supplier_landed_cost' ) !== false && strpos( $api, 'delivery_min_days' ) !== false && strpos( $api, 'delivery_max_days' ) !== false,
    'size guide manual provenance stored' => strpos( $api, "'supplier_value'" ) !== false && strpos( $api, "'manual_updated_at'" ) !== false && strpos( $api, "'target_value'" ) !== false,
    'global WooCommerce attributes supported' => strpos( $api, 'wc_create_attribute' ) !== false && strpos( $api, 'target_attribute_type' ) !== false,
    'supplier SKU fail closed' => strpos( $rules, 'cdh_supplier_sku_matrix_missing' ) !== false && strpos( $rules, 'cdh_supplier_sku_price_missing' ) !== false,
    'supplier SKU stock contract' => strpos( $api, "'stock_qty'" ) !== false && strpos( $api, "'stock_status'" ) !== false && strpos( $rules, 'supplier_stock_qty' ) !== false,
    'supplier SKU stock snapshot' => strpos( $api, '_cdh_supplier_sku_snapshot_v1' ) !== false && strpos( $api, '_cdh_supplier_sku_baseline_v1' ) !== false && strpos( $api, '_cdh_supplier_stock_qty_count' ) !== false,
    'supplier stock does not auto-sync WC' => strpos( $api, 'set_manage_stock' ) === false && strpos( $api, 'set_stock_quantity' ) === false,
    'priced variations created' => strpos( $api, 'create_priced_variations' ) !== false && strpos( $api, 'WC_Product_Variation' ) !== false,
    'pricing audit saved' => strpos( $api, '_cdh_pricing_rule_version' ) !== false && strpos( $api, '_cdh_pricing_trace' ) !== false,
    'manual override protected' => strpos( $pricing, '_cdh_pricing_manual_override' ) !== false && strpos( $rules, '_cdh_pricing_manual_override' ) !== false,
    'reprice action' => strpos( $rules, 'cdh_reprice_product' ) !== false && strpos( $pricing, 'Recalculer les prix automatiques' ) !== false,
    'Import AliExpress status' => strpos( $status, "const STATUS = 'cdh_aliexpress'" ) !== false,
    'currency authority' => strpos( $api, 'cdh_currency_mismatch' ) !== false,
    'supplier product tab' => strpos( $supplier, "'cdh_supplier'" ) !== false && strpos( $supplier, 'Fournisseur' ) !== false,
    'supplier product identity immutable' => strpos( $supplier, 'Identité verrouillée pour empêcher les doublons' ) !== false && strpos( $supplier, "'id'          => '_cdh_supplier_product_id'" ) === false,
    'separate descriptive attrs' => strpos( $api, '$attribute->set_variation( false )' ) !== false && strpos( $api, '$attribute->set_variation( true )' ) !== false,
    'obsolete pricing sanitizer removed' => strpos( $api, 'sanitize_variation_pricing' ) === false,
    'inline pricing JSON hardened' => strpos( $app, "str_replace( '</'" ) !== false && strpos( $app, "<\\\\/" ) !== false,
    'rc18 size guide range sanitizer' => strpos( $api, "'value_type' => \$value_type" ) !== false && strpos( $api, "'supplier_min' => \$supplier_min" ) !== false && strpos( $api, "'unit_conflict' => ! empty" ) !== false,
    'rc18 size guide frontend range rendering' => strpos( $extras, "'range' === (string)" ) !== false && strpos( $extras, "Tour de taille" ) !== false,
    'rc19 supplier identity required before media validation' => false !== $import_identity && false !== $import_video_validation && $import_identity < $import_video_validation,
    'rc19 idempotent replay response retained' => strpos( $api, 'idempotent_replay' ) !== false && strpos( $api, "'import_action'       => 'existing'" ) !== false,
    'rc19 concurrent import lock retained' => strpos( $api, 'IMPORT_LOCK_PREFIX' ) !== false && strpos( $api, 'add_option( $option_name' ) !== false && strpos( $api, 'cdh_import_in_progress' ) !== false,
    'rc19 identity persisted before product enrichment' => false !== $identity_persist && false !== $product_enrichment && $identity_persist < $product_enrichment,
    'rc19 duplicate supplier identity fails closed' => strpos( $api, 'cdh_duplicate_supplier_identity' ) !== false,
    'rc19 incomplete import fails closed' => strpos( $api, "'_cdh_import_state', 'processing'" ) !== false && strpos( $api, "'_cdh_import_state', 'complete'" ) !== false && strpos( $api, 'cdh_incomplete_import' ) !== false,
    'rc20 replay media cleanup' => strpos( $guard, 'cleanup_idempotent_replay_media' ) !== false && strpos( $guard, 'discarded_temp_media' ) !== false,
    'rc20 abandoned media cleanup' => strpos( $guard, 'cleanup_abandoned_media' ) !== false && strpos( $guard, 'DAY_IN_SECONDS' ) !== false,
);
foreach ( $checks as $label => $ok ) { echo ( $ok ? 'PASS' : 'FAIL' ) . " | $label\n"; if ( ! $ok ) exit( 1 ); }

// Pure pricing checks: no WordPress bootstrap needed for valid paths.
if ( ! defined( 'ABSPATH' ) ) define( 'ABSPATH', $root . '/' );
require_once $root . '/includes/class-cdh-pricing-rules.php';
$rule = array(
    'configured' => true, 'name' => 'Test', 'version' => 3,
    'steps' => array(
        array( 'type' => 'multiply', 'value' => 1.5, 'enabled' => true ),
        array( 'type' => 'add_fixed', 'value' => 4, 'enabled' => true ),
        array( 'type' => 'psychological', 'value' => 0, 'suffix' => 0.90, 'mode' => 'nearest', 'enabled' => true ),
    ),
);
$calc = CDH_Pricing_Rules::calculate( 12, $rule );
$ok = is_array( $calc ) && abs( $calc['final_price'] - 21.90 ) < 0.001;
echo ( $ok ? 'PASS' : 'FAIL' ) . " | formula 12 x1.5 +4 => nearest .90 = 21.90\n";
if ( ! $ok ) exit( 1 );
$up = CDH_Pricing_Rules::psychological_price( 22.75, 0.90, 'nearest' );
$down = CDH_Pricing_Rules::psychological_price( 22.25, 0.90, 'nearest' );
$ok = abs( $up - 22.90 ) < 0.001 && abs( $down - 21.90 ) < 0.001;
echo ( $ok ? 'PASS' : 'FAIL' ) . " | psychological nearest examples\n";
if ( ! $ok ) exit( 1 );
