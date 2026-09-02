<?php
$tests = array( 'smoke.php', 'pricing-behavior.php', 'temp-media-guard.php', 'supplier-identity-lock.php' );
foreach ( $tests as $test ) {
    $cmd = escapeshellarg( PHP_BINARY ) . ' ' . escapeshellarg( __DIR__ . '/' . $test );
    passthru( $cmd, $code );
    if ( 0 !== $code ) exit( $code );
}
echo "PASS | all WordPress stabilization tests\n";
