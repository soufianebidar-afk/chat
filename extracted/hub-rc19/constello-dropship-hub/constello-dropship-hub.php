<?php
/**
 * Plugin Name: Constello Dropship Hub
 * Description: Application Constello pour préparer et importer des produits AliExpress dans WooCommerce.
 * Version: 1.0.0-rc19-idempotent-import
 * Author: Constello
 * Requires at least: 6.0
 * Requires PHP: 7.4
 * Requires Plugins: woocommerce
 * Text Domain: constello-dropship-hub
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

define( 'CDH_VERSION', '1.0.0-rc19-idempotent-import' );
define( 'CDH_FILE', __FILE__ );
define( 'CDH_DIR', plugin_dir_path( __FILE__ ) );
define( 'CDH_URL', plugin_dir_url( __FILE__ ) );

require_once CDH_DIR . 'includes/class-constello-admin-shell.php';
require_once CDH_DIR . 'includes/class-cdh-import-aliexpress-status.php';
require_once CDH_DIR . 'includes/class-cdh-catalog-settings.php';
require_once CDH_DIR . 'includes/class-cdh-rest-api.php';
require_once CDH_DIR . 'includes/class-cdh-supplier-product-data.php';
require_once CDH_DIR . 'includes/class-cdh-product-extras.php';
require_once CDH_DIR . 'includes/class-cdh-pricing-rules.php';
require_once CDH_DIR . 'includes/class-cdh-pricing-product-data.php';
require_once CDH_DIR . 'includes/class-cdh-admin-shell.php';

add_action( 'plugins_loaded', static function () {
    CDH_Import_AliExpress_Status::init();
    CDH_Catalog_Settings::init();
    CDH_REST_API::init();
    CDH_Supplier_Product_Data::init();
    CDH_Product_Extras::init();
    CDH_Pricing_Rules::init();
    CDH_Pricing_Product_Data::init();
    CDH_Admin_Shell::init();
}, 20 );
