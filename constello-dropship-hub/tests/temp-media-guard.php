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
    'idempotent replay cleanup runs post dispatch' => false !== strpos( $guard, "add_filter( 'rest_post_dispatch', array( __CLASS__, 'cleanup_idempotent_replay_media' )" ),
    'replay cleanup requires explicit 200 idempotent replay' => false !== strpos( $guard, '200 !== $response->get_status()' ) && false !== strpos( $guard, 'true !== ( $data[\'idempotent_replay\'] ?? false )' ),
    'replay cleanup scans request media IDs' => false !== strpos( $guard, 'collect_request_media_ids' ) && false !== strpos( $guard, "array( 'media_id', 'image_media_id' )" ) && false !== strpos( $guard, "'image_media_ids' === $key" ),
    'replay cleanup reports discarded media' => false !== strpos( $guard, "'discarded_temp_media'" ),
    'in-progress 409 is deliberately not replay-cleaned' => false !== strpos( $guard, 'Do not clean 409/in-progress requests here' ),
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
