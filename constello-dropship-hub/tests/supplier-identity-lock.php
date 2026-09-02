<?php
$root = dirname( __DIR__ );
$path = $root . '/includes/class-cdh-supplier-product-data.php';
if ( ! is_file( $path ) ) {
    fwrite( STDERR, "FAIL | supplier product data class missing\n" );
    exit( 1 );
}
$code = file_get_contents( $path );
$save_pos = strpos( $code, 'public static function save_panel' );
$save_code = false !== $save_pos ? substr( $code, $save_pos ) : '';
$checks = array(
    'supplier product ID rendered read-only' => false !== strpos( $code, "readonly_row(\n            __( 'ID produit fournisseur'" ),
    'identity explanation visible' => false !== strpos( $code, 'Identité verrouillée pour empêcher les doublons' ),
    'editable supplier text fields are explicitly allowlisted' => false !== strpos( $save_code, "array( '_cdh_supplier_store_name', '_cdh_supplier_seller_id' )" ),
    'supplier product ID excluded from editable input declaration' => false === strpos( $code, "'id'          => '_cdh_supplier_product_id'" ),
    'supplier URLs remain editable' => false !== strpos( $save_code, "'_cdh_supplier_url', '_cdh_supplier_store_url'" ),
);
foreach ( $checks as $label => $ok ) {
    echo ( $ok ? 'PASS' : 'FAIL' ) . ' | ' . $label . "\n";
    if ( ! $ok ) exit( 1 );
}
