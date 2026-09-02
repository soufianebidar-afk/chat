<?php
$root = dirname( __DIR__ );
$main_path  = $root . '/constello-dropship-hub.php';
$guard_path = $root . '/includes/class-cdh-temp-media-guard.php';

if ( ! is_file( $main_path ) || ! is_file( $guard_path ) ) {
    fwrite( STDERR, "FAIL | RC20 media guard files missing\n" );
    exit( 1 );
}

$main  = file_get_contents( $main_path );
$guard = file_get_contents( $guard_path );
$checks = array(
    'rc20 version' => false !== strpos( $main, '1.0.0-rc20-media-guard' ),
    'guard loaded' => false !== strpos( $main, "class-cdh-temp-media-guard.php" ) && false !== strpos( $main, 'CDH_Temp_Media_Guard::init()' ),
    'three media routes guarded' => false !== strpos( $guard, "'/cdh/v1/import-media'" ) && false !== strpos( $guard, "'/cdh/v1/import-video'" ) && false !== strpos( $guard, "'/cdh/v1/import-document'" ),
    'dedupe dispatch runs after route permissions' => false !== strpos( $guard, 'rest_dispatch_request' ) && false === strpos( $guard, 'rest_pre_dispatch' ),
    'request fingerprint dedupe' => false !== strpos( $guard, 'FINGERPRINT_META' ) && false !== strpos( $guard, "hash( 'sha256'" ),
    'fingerprint persisted after callback' => false !== strpos( $guard, 'rest_request_after_callbacks' ) && false !== strpos( $guard, 'remember_media_fingerprint' ),
    'reused response preserves 201 contract' => false !== strpos( $guard, "'reused'   => true" ) && false !== strpos( $guard, '), 201 );' ),
    'reuse restricted to unattached temporary media' => false !== strpos( $guard, 'is_temporary_unattached' ) && false !== strpos( $guard, "'post_parent'            => 0" ) && false !== strpos( $guard, 'wp_get_post_parent_id' ),
    'reuse refreshes cleanup TTL' => false !== strpos( $guard, 'update_post_meta( $attachment_id, self::CREATED_AT_META, time() )' ),
    'cleanup scheduled hourly' => false !== strpos( $guard, "wp_schedule_event( time() + HOUR_IN_SECONDS, 'hourly'" ),
    'cleanup waits one day' => false !== strpos( $guard, 'const CLEANUP_TTL      = DAY_IN_SECONDS;' ),
    'cleanup requires CDH temporary flag' => false !== strpos( $guard, "'_cdh_temp_import_media'" ) && false !== strpos( $guard, "'_cdh_temp_import_video'" ) && false !== strpos( $guard, "'_cdh_temp_import_document'" ),
    'cleanup permanently deletes abandoned attachment' => false !== strpos( $guard, 'wp_delete_attachment( $attachment_id, true )' ),
);

foreach ( $checks as $label => $ok ) {
    echo ( $ok ? 'PASS' : 'FAIL' ) . ' | ' . $label . "\n";
    if ( ! $ok ) {
        exit( 1 );
    }
}
