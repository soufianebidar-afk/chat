<?php
$root = dirname( __DIR__ );
if ( ! defined( 'ABSPATH' ) ) define( 'ABSPATH', $root . '/' );

$GLOBALS['cdh_test_option'] = array(
    'configured' => true,
    'name' => 'Standard',
    'version' => 4,
    'updated_at' => '2026-09-01 00:00:00',
    'steps' => array(
        array( 'id' => 'm1', 'type' => 'multiply', 'value' => 1.5, 'enabled' => true ),
        array( 'id' => 'a1', 'type' => 'add_fixed', 'value' => 4, 'enabled' => true ),
        array( 'id' => 'p1', 'type' => 'psychological', 'value' => 0, 'suffix' => 0.90, 'mode' => 'nearest', 'enabled' => true ),
    ),
);

if ( ! class_exists( 'WP_Error' ) ) {
    class WP_Error {
        public $code; public $message; public $data;
        public function __construct( $code = '', $message = '', $data = null ) { $this->code=$code; $this->message=$message; $this->data=$data; }
        public function add_data( $data ) { $this->data = $data; }
        public function get_error_code() { return $this->code; }
        public function get_error_data() { return $this->data; }
    }
}
function is_wp_error( $v ) { return $v instanceof WP_Error; }
function __( $s ) { return $s; }
function esc_html__( $s ) { return $s; }
function get_option( $key, $default = array() ) { return $GLOBALS['cdh_test_option'] ?? $default; }
function sanitize_text_field( $s ) { return trim( strip_tags( (string) $s ) ); }
function sanitize_key( $s ) { return preg_replace( '/[^a-z0-9_\-]/', '', strtolower( (string) $s ) ); }
function absint( $n ) { return abs( (int) $n ); }
function wp_generate_uuid4() { return 'test-uuid'; }
function current_time() { return '2026-09-01 00:00:00'; }
function wp_json_encode( $v, $flags = 0 ) { return json_encode( $v, $flags ); }
function wc_get_price_decimals() { return 2; }

require_once $root . '/includes/class-cdh-pricing-rules.php';

function check( $ok, $label ) {
    echo ( $ok ? 'PASS' : 'FAIL' ) . " | $label\n";
    if ( ! $ok ) exit( 1 );
}

$summary = CDH_Pricing_Rules::public_summary();
check( $summary['configured'] === true && $summary['version'] === 4 && $summary['step_count'] === 3, 'public summary exposes active pricing rule' );

$calc12 = CDH_Pricing_Rules::calculate( 12 );
$calc18 = CDH_Pricing_Rules::calculate( 18 );
check( ! is_wp_error( $calc12 ) && abs( $calc12['final_price'] - 21.90 ) < 0.001, '12 CHF supplier cost computes to 21.90' );
check( ! is_wp_error( $calc18 ) && abs( $calc18['final_price'] - 30.90 ) < 0.001, '18 CHF supplier cost computes independently to 30.90' );
check( $calc12['final_price'] !== $calc18['final_price'], 'distinct supplier SKU costs produce distinct WooCommerce prices' );

$missing = CDH_Pricing_Rules::build_import_pricing( array(), 12, true, 'CHF' );
check( is_wp_error( $missing ) && $missing->get_error_code() === 'cdh_supplier_sku_matrix_missing', 'variable import without real SKU matrix is fail-closed' );

$rows = array(
    array(
        'supplier_sku_id' => 'sku-a',
        'attributes' => array( array( 'name' => 'Puissance', 'value' => '7W' ) ),
        'supplier_price' => array( 'amount' => 12, 'currency' => 'CHF' ),
        'stock_qty' => 5,
        'stock_status' => 'in_stock',
        'available' => true,
        'observed_at' => '2026-09-01T18:00:00Z',
    ),
    array(
        'supplier_sku_id' => 'sku-b',
        'attributes' => array( array( 'name' => 'Puissance', 'value' => '12W' ) ),
        'supplier_price' => array( 'amount' => 18, 'currency' => 'CHF' ),
        'stock_qty' => 0,
        'stock_status' => 'out_of_stock',
        'available' => false,
        'observed_at' => '2026-09-01T18:00:00Z',
    ),
);
$pricing = CDH_Pricing_Rules::build_import_pricing( $rows, 12, true, 'CHF' );
check( ! is_wp_error( $pricing ) && count( $pricing['combinations'] ) === 2, 'real SKU matrix builds exactly two combinations' );
check( abs( $pricing['combinations'][0]['regular_price'] - 21.90 ) < 0.001 && abs( $pricing['combinations'][1]['regular_price'] - 30.90 ) < 0.001, 'each SKU uses its own supplier cost' );
check( $pricing['combinations'][0]['supplier_stock_qty'] === 5.0 && $pricing['combinations'][0]['supplier_stock_status'] === 'in_stock', 'supplier stock quantity/status is carried with first SKU' );
check( $pricing['combinations'][1]['supplier_stock_qty'] === 0.0 && $pricing['combinations'][1]['supplier_stock_status'] === 'out_of_stock', 'real zero supplier stock is preserved for second SKU' );
check( $pricing['combinations'][1]['supplier_available'] === false, 'supplier availability is kept independently from price' );

$badPrice = $rows; unset( $badPrice[1]['supplier_price'] );
$err = CDH_Pricing_Rules::build_import_pricing( $badPrice, 12, true, 'CHF' );
check( is_wp_error( $err ) && $err->get_error_code() === 'cdh_supplier_sku_price_missing', 'missing supplier SKU price blocks import' );

$badCurrency = $rows; $badCurrency[1]['supplier_price']['currency'] = 'EUR';
$err = CDH_Pricing_Rules::build_import_pricing( $badCurrency, 12, true, 'CHF' );
check( is_wp_error( $err ) && $err->get_error_code() === 'cdh_supplier_variation_currency_mismatch', 'SKU currency mismatch blocks import' );

$ambiguous = $rows;
$ambiguous[1]['attributes'] = $ambiguous[0]['attributes'];
$err = CDH_Pricing_Rules::build_import_pricing( $ambiguous, 12, true, 'CHF' );
check( is_wp_error( $err ) && $err->get_error_code() === 'cdh_supplier_sku_ambiguous', 'duplicate supplier combination is rejected' );

$GLOBALS['cdh_test_option'] = array( 'configured' => false, 'name' => 'None', 'version' => 0, 'steps' => array() );
$err = CDH_Pricing_Rules::build_import_pricing( $rows, 12, true, 'CHF' );
check( is_wp_error( $err ) && $err->get_error_code() === 'cdh_pricing_rule_missing', 'missing WordPress pricing rule blocks import' );
