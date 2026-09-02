<?php
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Constello Dropship Hub registration inside the shared Constello Admin Shell.
 *
 * The Shell is the exact RC129 mechanism used by Smart Index: one WordPress
 * parent (constello-app), one visible route per application, secondary routes
 * hidden from the native sidebar, shared theme preference and shared header.
 */
final class CDH_Admin_Shell {
	const CAP    = 'manage_woocommerce';
	const APP_ID = 'dropship-hub';

	const ROUTE_OVERVIEW = 'constello-dropship-hub';
	const ROUTE_IMPORT   = 'constello-dropship-hub-import';
	const ROUTE_PRODUCTS = 'constello-dropship-hub-products';
	const ROUTE_SETTINGS = 'constello-dropship-hub-settings';

	public static function init() {
		add_filter( 'constello_admin_apps', array( __CLASS__, 'register_constello_app' ) );
		add_filter( 'constello_admin_notifications', array( __CLASS__, 'register_notifications' ) );

		// Idempotent. If Smart Index already initialized the shared Shell this is a no-op.
		Constello_Admin_Shell::init();

		add_action( 'admin_enqueue_scripts', array( __CLASS__, 'assets' ) );
	}

	public static function register_constello_app( $apps ) {
		if ( ! is_array( $apps ) ) {
			$apps = array();
		}

		$apps[ self::APP_ID ] = array(
			'id'                => self::APP_ID,
			// Keep the native WordPress submenu compact; the Constello parent already carries the brand.
			'name'              => __( 'Dropship Hub', 'constello-dropship-hub' ),
			'header_name'       => sprintf( __( 'Constello Dropship Hub · v%s', 'constello-dropship-hub' ), CDH_VERSION ),
			'tagline'           => __( 'Préparez vos produits fournisseurs avant leur publication.', 'constello-dropship-hub' ),
			'description'       => __( 'Importez depuis AliExpress, vérifiez les médias, catégories et variantes, puis finalisez le produit dans WooCommerce.', 'constello-dropship-hub' ),
			'features'          => array(
				__( 'Import AliExpress', 'constello-dropship-hub' ),
				__( 'Préparation des médias', 'constello-dropship-hub' ),
				__( 'Catégories et variantes', 'constello-dropship-hub' ),
				__( 'File Import AliExpress', 'constello-dropship-hub' ),
			),
			'icon'              => 'package',
			'order'             => 30,
			'capability'        => self::CAP,
			'overview_callback' => array( __CLASS__, 'constello_overview_data' ),
			'routes'            => array(
				array(
					'id'       => 'overview',
					'slug'     => self::ROUTE_OVERVIEW,
					'label'    => __( 'Vue d’ensemble', 'constello-dropship-hub' ),
					'icon'     => 'grid',
					'callback' => array( __CLASS__, 'render_dashboard' ),
				),
				array(
					'id'       => 'import',
					'slug'     => self::ROUTE_IMPORT,
					'label'    => __( 'Import AliExpress', 'constello-dropship-hub' ),
					'icon'     => 'send',
					'callback' => array( __CLASS__, 'render_import' ),
				),
				array(
					'id'       => 'products',
					'slug'     => self::ROUTE_PRODUCTS,
					'label'    => __( 'Produits importés', 'constello-dropship-hub' ),
					'icon'     => 'package',
					'callback' => array( __CLASS__, 'render_products' ),
				),
				array(
					'id'       => 'settings',
					'slug'     => self::ROUTE_SETTINGS,
					'label'    => __( 'Réglages', 'constello-dropship-hub' ),
					'icon'     => 'settings',
					'callback' => array( __CLASS__, 'render_settings' ),
				),
			),
		);

		return $apps;
	}

	public static function register_notifications( $notifications ) {
		if ( ! is_array( $notifications ) ) {
			$notifications = array();
		}

		if ( ! get_option( CDH_REST_API::OPTION_KEY_HASH, '' ) ) {
			$notifications[] = array(
				'id'           => 'api-key-missing',
				'app_id'       => self::APP_ID,
				'severity'     => 'warn',
				'title'        => __( 'Extension AliExpress', 'constello-dropship-hub' ),
				'message'      => __( 'La clé API de l’extension n’est pas encore configurée.', 'constello-dropship-hub' ),
				'action_label' => __( 'Configurer', 'constello-dropship-hub' ),
				'url'          => admin_url( 'admin.php?page=' . self::ROUTE_SETTINGS ),
			);
		}

		return $notifications;
	}

	public static function constello_overview_data() {
		$counts   = wp_count_posts( 'product', 'readable' );
		$imports  = isset( $counts->{ CDH_Import_AliExpress_Status::STATUS } ) ? (int) $counts->{ CDH_Import_AliExpress_Status::STATUS } : 0;
		$currency = function_exists( 'get_woocommerce_currency' ) ? get_woocommerce_currency() : '—';
		$api      = (bool) get_option( CDH_REST_API::OPTION_KEY_HASH, '' );

		return array(
			'state'       => $api ? 'ok' : 'attention',
			'state_label' => $api ? __( 'Opérationnel', 'constello-dropship-hub' ) : __( 'Configuration requise', 'constello-dropship-hub' ),
			'metrics'     => array(
				array( 'value' => number_format_i18n( $imports ), 'label' => __( 'à préparer', 'constello-dropship-hub' ) ),
				array( 'value' => $currency, 'label' => __( 'devise boutique', 'constello-dropship-hub' ) ),
				array( 'value' => $api ? __( 'Prête', 'constello-dropship-hub' ) : __( 'À configurer', 'constello-dropship-hub' ), 'label' => __( 'extension', 'constello-dropship-hub' ) ),
			),
		);
	}

	public static function assets( $hook ) {
		$page = isset( $_GET['page'] ) ? sanitize_key( wp_unslash( $_GET['page'] ) ) : ''; // phpcs:ignore WordPress.Security.NonceVerification.Recommended
		if ( 0 !== strpos( $page, 'constello-dropship-hub' ) ) {
			return;
		}
		wp_enqueue_style( 'cdh-admin', CDH_URL . 'assets/admin.css', array( 'constello-admin-shell' ), CDH_VERSION );
	}

	private static function open_page( $title, $lead ) {
		if ( ! current_user_can( self::CAP ) ) {
			wp_die( esc_html__( 'Accès refusé.', 'constello-dropship-hub' ) );
		}
		Constello_Admin_Shell::app_header( self::APP_ID, $title, $lead, null, 'nav-first' );
	}

	private static function close_page() {
		echo '</div>';
	}

	public static function render_dashboard() {
		$counts    = wp_count_posts( 'product', 'readable' );
		$imports   = isset( $counts->{ CDH_Import_AliExpress_Status::STATUS } ) ? (int) $counts->{ CDH_Import_AliExpress_Status::STATUS } : 0;
		$currency  = function_exists( 'get_woocommerce_currency' ) ? get_woocommerce_currency() : '—';
		$api_ready = (bool) get_option( CDH_REST_API::OPTION_KEY_HASH, '' );

		self::open_page( __( 'Vue d’ensemble', 'constello-dropship-hub' ), __( 'Préparez vos produits fournisseurs avant leur publication dans WooCommerce.', 'constello-dropship-hub' ) );

		echo '<div class="cdh-metric-grid">';
		self::metric( __( 'Import AliExpress', 'constello-dropship-hub' ), number_format_i18n( $imports ), __( 'produit(s) à préparer', 'constello-dropship-hub' ) );
		self::metric( __( 'Devise boutique', 'constello-dropship-hub' ), $currency, __( 'autorité WooCommerce', 'constello-dropship-hub' ) );
		self::metric( __( 'Extension', 'constello-dropship-hub' ), $api_ready ? __( 'Prête', 'constello-dropship-hub' ) : __( 'À configurer', 'constello-dropship-hub' ), $api_ready ? __( 'clé API active', 'constello-dropship-hub' ) : __( 'clé API requise', 'constello-dropship-hub' ) );
		echo '</div>';

		echo '<div class="cdh-content-grid">';
		echo '<section class="cdh-card"><div class="cdh-card-head"><div><span class="cdh-card-eyebrow">ALIEXPRESS</span><h2>' . esc_html__( 'Préparer un produit', 'constello-dropship-hub' ) . '</h2></div></div><p>' . esc_html__( 'L’extension lit la fiche fournisseur, vous laisse corriger les informations puis crée le produit avec le statut Import AliExpress.', 'constello-dropship-hub' ) . '</p><a class="cdh-action cdh-action-primary" href="' . esc_url( admin_url( 'admin.php?page=' . self::ROUTE_IMPORT ) ) . '">' . esc_html__( 'Voir le flux d’import', 'constello-dropship-hub' ) . '</a></section>';
		echo '<section class="cdh-card"><div class="cdh-card-head"><div><span class="cdh-card-eyebrow">WOOCOMMERCE</span><h2>' . esc_html__( 'File de préparation', 'constello-dropship-hub' ) . '</h2></div><span class="cdh-count">' . esc_html( number_format_i18n( $imports ) ) . '</span></div><p>' . esc_html__( 'Les produits restent invisibles sur la boutique tant qu’ils sont au statut Import AliExpress.', 'constello-dropship-hub' ) . '</p><a class="cdh-action" href="' . esc_url( admin_url( 'admin.php?page=' . self::ROUTE_PRODUCTS ) ) . '">' . esc_html__( 'Ouvrir les produits importés', 'constello-dropship-hub' ) . '</a></section>';
		echo '</div>';

		self::close_page();
	}

	private static function metric( $label, $value, $hint ) {
		echo '<section class="cdh-metric"><span>' . esc_html( $label ) . '</span><strong>' . esc_html( $value ) . '</strong><small>' . esc_html( $hint ) . '</small></section>';
	}

	public static function render_import() {
		self::open_page( __( 'Import AliExpress', 'constello-dropship-hub' ), __( 'Connexion entre l’extension Constello Dropship Hub et cette boutique.', 'constello-dropship-hub' ) );

		echo '<section class="cdh-card cdh-flow-card"><div class="cdh-card-head"><div><span class="cdh-card-eyebrow">FLUX</span><h2>' . esc_html__( 'De la fiche fournisseur à WooCommerce', 'constello-dropship-hub' ) . '</h2></div></div>';
		echo '<ol class="cdh-steps"><li><b>1</b><span><strong>' . esc_html__( 'Connexion AliExpress', 'constello-dropship-hub' ) . '</strong><small>' . esc_html__( 'Affichez AliExpress dans la même devise que WooCommerce.', 'constello-dropship-hub' ) . '</small></span></li><li><b>2</b><span><strong>' . esc_html__( 'Préparation dans l’extension', 'constello-dropship-hub' ) . '</strong><small>' . esc_html__( 'Titre, prix, catégorie, médias et variantes restent modifiables avant l’envoi.', 'constello-dropship-hub' ) . '</small></span></li><li><b>3</b><span><strong>' . esc_html__( 'Import WooCommerce', 'constello-dropship-hub' ) . '</strong><small>' . esc_html__( 'Le produit est créé avec le statut Import AliExpress.', 'constello-dropship-hub' ) . '</small></span></li></ol>';
		echo '<div class="cdh-endpoints"><div><span>Import</span><code>' . esc_html( rest_url( 'cdh/v1/import' ) ) . '</code></div><div><span>Catégories</span><code>' . esc_html( rest_url( 'cdh/v1/categories' ) ) . '</code></div><div><span>Médias</span><code>' . esc_html( rest_url( 'cdh/v1/import-media' ) ) . '</code></div><div><span>Configuration</span><code>' . esc_html( rest_url( 'cdh/v1/config' ) ) . '</code></div></div>';
		echo '<a class="cdh-action cdh-action-primary" href="' . esc_url( admin_url( 'admin.php?page=' . self::ROUTE_SETTINGS ) ) . '">' . esc_html__( 'Configurer la connexion', 'constello-dropship-hub' ) . '</a></section>';

		self::close_page();
	}

	public static function render_products() {
		self::open_page( __( 'Produits importés', 'constello-dropship-hub' ), __( 'Produits arrivés depuis AliExpress et encore au statut Import AliExpress.', 'constello-dropship-hub' ) );

		$query = new WP_Query(
			array(
				'post_type'      => 'product',
				'post_status'    => CDH_Import_AliExpress_Status::STATUS,
				'posts_per_page' => 50,
				'orderby'        => 'date',
				'order'          => 'DESC',
				'no_found_rows'  => false,
			)
		);

		echo '<section class="cdh-card"><div class="cdh-card-head"><div><span class="cdh-card-eyebrow">IMPORT ALIEXPRESS</span><h2>' . esc_html( sprintf( _n( '%s produit à préparer', '%s produits à préparer', (int) $query->found_posts, 'constello-dropship-hub' ), number_format_i18n( (int) $query->found_posts ) ) ) . '</h2></div><a class="cdh-action" href="' . esc_url( add_query_arg( array( 'post_type' => 'product', 'post_status' => CDH_Import_AliExpress_Status::STATUS ), admin_url( 'edit.php' ) ) ) . '">' . esc_html__( 'Voir dans WooCommerce', 'constello-dropship-hub' ) . '</a></div>';

		if ( ! $query->have_posts() ) {
			echo '<div class="cdh-empty"><strong>' . esc_html__( 'Aucun produit en attente', 'constello-dropship-hub' ) . '</strong><p>' . esc_html__( 'Les prochains imports AliExpress apparaîtront ici automatiquement.', 'constello-dropship-hub' ) . '</p></div>';
		} else {
			echo '<div class="cdh-product-list">';
			while ( $query->have_posts() ) {
				$query->the_post();
				$product_id  = get_the_ID();
				$thumb       = get_the_post_thumbnail_url( $product_id, 'thumbnail' );
				$source_url  = (string) get_post_meta( $product_id, '_cdh_supplier_url', true );
				$supplier_id = (string) get_post_meta( $product_id, '_cdh_supplier_product_id', true );
				$edit_url    = get_edit_post_link( $product_id, 'raw' );

				echo '<article class="cdh-product-row"><div class="cdh-product-thumb">';
				if ( $thumb ) {
					echo '<img src="' . esc_url( $thumb ) . '" alt="">';
				} else {
					echo '<span aria-hidden="true">□</span>';
				}
				echo '</div><div class="cdh-product-copy"><strong>' . esc_html( get_the_title() ) . '</strong><span>#' . esc_html( (string) $product_id ) . ( $supplier_id ? ' · AliExpress ' . esc_html( $supplier_id ) : '' ) . '</span></div><div class="cdh-product-actions"><a class="cdh-action cdh-action-primary" href="' . esc_url( $edit_url ) . '">' . esc_html__( 'Ouvrir dans WooCommerce', 'constello-dropship-hub' ) . '</a>';
				if ( $source_url ) {
					echo '<a class="cdh-action" target="_blank" rel="noopener noreferrer" href="' . esc_url( $source_url ) . '">' . esc_html__( 'Voir la source', 'constello-dropship-hub' ) . '</a>';
				}
				echo '</div></article>';
			}
			echo '</div>';
			wp_reset_postdata();
		}
		echo '</section>';

		self::close_page();
	}

	public static function render_settings() {
		$hash  = (string) get_option( CDH_REST_API::OPTION_KEY_HASH, '' );
		$plain = get_transient( CDH_REST_API::KEY_NOTICE_PREFIX . get_current_user_id() );
		if ( $plain ) {
			delete_transient( CDH_REST_API::KEY_NOTICE_PREFIX . get_current_user_id() );
		}

		self::open_page( __( 'Réglages', 'constello-dropship-hub' ), __( 'Connexion de l’extension et paramètres hérités de WooCommerce.', 'constello-dropship-hub' ) );

		echo '<div class="cdh-content-grid"><section class="cdh-card"><div class="cdh-card-head"><div><span class="cdh-card-eyebrow">EXTENSION</span><h2>' . esc_html__( 'Connexion API', 'constello-dropship-hub' ) . '</h2></div></div><p>' . esc_html__( 'La clé authentifie uniquement l’extension Constello Dropship Hub auprès de ce site.', 'constello-dropship-hub' ) . '</p>';
		if ( $plain ) {
			echo '<div class="cdh-key-box"><strong>' . esc_html__( 'Nouvelle clé — copiez-la maintenant', 'constello-dropship-hub' ) . '</strong><code>' . esc_html( $plain ) . '</code><small>' . esc_html__( 'Elle ne sera plus affichée après avoir quitté cette page.', 'constello-dropship-hub' ) . '</small></div>';
		} else {
			echo '<p class="cdh-state ' . ( $hash ? 'is-ok' : 'is-warn' ) . '">' . esc_html( $hash ? __( 'Clé API configurée', 'constello-dropship-hub' ) : __( 'Aucune clé API configurée', 'constello-dropship-hub' ) ) . '</p>';
		}
		echo '<form method="post" action="' . esc_url( admin_url( 'admin-post.php' ) ) . '"><input type="hidden" name="action" value="cdh_rotate_api_key">';
		wp_nonce_field( 'cdh_rotate_api_key' );
		echo '<button class="cdh-action cdh-action-primary" type="submit">' . esc_html( $hash ? __( 'Remplacer la clé API', 'constello-dropship-hub' ) : __( 'Générer une clé API', 'constello-dropship-hub' ) ) . '</button></form></section>';

		$currency = function_exists( 'get_woocommerce_currency' ) ? get_woocommerce_currency() : '—';
		echo '<section class="cdh-card"><div class="cdh-card-head"><div><span class="cdh-card-eyebrow">WOOCOMMERCE</span><h2>' . esc_html__( 'Configuration héritée', 'constello-dropship-hub' ) . '</h2></div></div><dl class="cdh-defs"><div><dt>' . esc_html__( 'Site', 'constello-dropship-hub' ) . '</dt><dd>' . esc_html( home_url( '/' ) ) . '</dd></div><div><dt>' . esc_html__( 'Devise native', 'constello-dropship-hub' ) . '</dt><dd><strong>' . esc_html( $currency ) . '</strong></dd></div><div><dt>' . esc_html__( 'Statut d’import', 'constello-dropship-hub' ) . '</dt><dd>Import AliExpress</dd></div></dl><p class="cdh-note">' . esc_html__( 'WooCommerce reste l’autorité de devise. Constello ne convertit pas les prix fournisseur.', 'constello-dropship-hub' ) . '</p></section></div>';

        self::render_pricing_settings( $currency );
        self::render_extraction_settings();
        self::render_mapping_settings();
		self::close_page();
	}
    private static function render_extraction_settings() {
        if ( ! class_exists( 'CDH_Catalog_Settings' ) ) return;
        $settings = CDH_Catalog_Settings::get_extraction_settings();
        $fields = CDH_Catalog_Settings::fields();
        $presets = CDH_Catalog_Settings::presets();
        if ( isset( $_GET['cdh_extraction_saved'] ) ) echo '<div class="notice notice-success is-dismissible"><p>' . esc_html__( 'Profil d’extraction enregistré.', 'constello-dropship-hub' ) . '</p></div>';
        echo '<section class="cdh-card cdh-extraction-settings" id="cdh-extraction-settings"><div class="cdh-card-head"><div><span class="cdh-card-eyebrow">EXTRACTION</span><h2>' . esc_html__( 'Données à récupérer', 'constello-dropship-hub' ) . '</h2><p>' . esc_html__( 'Choisissez ce que l’extension doit récupérer sur les fiches AliExpress. Les identifiants techniques nécessaires à la traçabilité et à l’anti-doublon restent toujours actifs.', 'constello-dropship-hub' ) . '</p></div><span class="cdh-count">' . esc_html( ucfirst( (string) $settings['profile'] ) ) . '</span></div>';
        echo '<form method="post" action="' . esc_url( admin_url( 'admin-post.php' ) ) . '" id="cdh-extraction-form"><input type="hidden" name="action" value="' . esc_attr( CDH_Catalog_Settings::ACTION_SAVE_EXTRACTION ) . '">';
        wp_nonce_field( CDH_Catalog_Settings::ACTION_SAVE_EXTRACTION );
        echo '<div class="cdh-extraction-presets"><label><span>' . esc_html__( 'Profil', 'constello-dropship-hub' ) . '</span><select id="cdh-extraction-profile" name="cdh_extraction_profile"><option value="essential">Essentiel</option><option value="standard">Standard</option><option value="complete">Complet</option><option value="custom">Personnalisé</option></select></label><p>' . esc_html__( 'Un profil préremplit les cases ; vous pouvez ensuite les adapter librement.', 'constello-dropship-hub' ) . '</p></div>';
        echo '<div class="cdh-extraction-grid">';
        foreach ( $fields as $key => $label ) {
            $checked = ! empty( $settings[ $key ] );
            echo '<label class="cdh-extraction-item"><input type="checkbox" name="cdh_extract_' . esc_attr( $key ) . '" value="1"' . checked( $checked, true, false ) . '><span><strong>' . esc_html( $label ) . '</strong><small>' . esc_html( in_array( $key, array( 'title','price','images','variants' ), true ) ? __( 'Recommandé pour la création du produit.', 'constello-dropship-hub' ) : __( 'Optionnel selon votre flux.', 'constello-dropship-hub' ) ) . '</small></span></label>';
        }
        echo '</div><div class="cdh-technical-lock"><strong>' . esc_html__( 'Toujours collectés', 'constello-dropship-hub' ) . '</strong><span>titre · prix fournisseur · supplier_key · product ID · URL fournisseur · devise · identifiants techniques nécessaires au dédoublonnage</span></div><div class="cdh-pricing-actions"><button type="submit" class="cdh-action cdh-action-primary">' . esc_html__( 'Enregistrer le profil', 'constello-dropship-hub' ) . '</button></div></form></section>';
        $presets_json = wp_json_encode( $presets );
        $settings_json = wp_json_encode( $settings );
        echo '<script>(function(){const root=document.getElementById("cdh-extraction-settings");if(!root)return;const presets=' . $presets_json . ', current=' . $settings_json . ';const select=root.querySelector("#cdh-extraction-profile");select.value=current.profile||"standard";const boxes=Array.from(root.querySelectorAll("input[type=checkbox][name^=cdh_extract_]"));function apply(name){if(!presets[name])return;boxes.forEach(b=>{const k=b.name.replace("cdh_extract_","");b.checked=!!presets[name][k];});}select.addEventListener("change",()=>{if(select.value!=="custom")apply(select.value)});boxes.forEach(b=>b.addEventListener("change",()=>{select.value="custom"}));})();</script>';
    }

    private static function render_mapping_settings() {
        if ( ! class_exists( 'CDH_Catalog_Settings' ) ) return;
        $mappings = CDH_Catalog_Settings::get_mappings();
        echo '<section class="cdh-card cdh-mapping-settings"><div class="cdh-card-head"><div><span class="cdh-card-eyebrow">CORRESPONDANCES</span><h2>' . esc_html__( 'Attributs fournisseur → WooCommerce', 'constello-dropship-hub' ) . '</h2><p>' . esc_html__( 'Constello mémorise les choix faits dans l’extension afin de proposer automatiquement les mêmes attributs lors des prochains imports.', 'constello-dropship-hub' ) . '</p></div><span class="cdh-count">' . esc_html( number_format_i18n( count( $mappings ) ) ) . '</span></div>';
        if ( ! $mappings ) {
            echo '<div class="cdh-empty"><strong>' . esc_html__( 'Aucune correspondance mémorisée', 'constello-dropship-hub' ) . '</strong><p>' . esc_html__( 'Les correspondances apparaîtront ici après vos premiers choix dans l’éditeur AliExpress.', 'constello-dropship-hub' ) . '</p></div>';
        } else {
            echo '<div class="cdh-mapping-table"><div class="cdh-mapping-head"><span>AliExpress</span><span>WooCommerce</span><span>Valeurs</span></div>';
            foreach ( $mappings as $mapping ) {
                if ( ! is_array( $mapping ) ) continue;
                $target = (string) ( $mapping['target_name'] ?? '' );
                $type = (string) ( $mapping['target_type'] ?? 'product' );
                echo '<div class="cdh-mapping-row"><strong>' . esc_html( (string) ( $mapping['source_label'] ?? '' ) ) . '</strong><span>' . esc_html( $target ?: '—' ) . '<small>' . esc_html( 'global' === $type || 'create_global' === $type ? __( 'Attribut global', 'constello-dropship-hub' ) : __( 'Attribut du produit', 'constello-dropship-hub' ) ) . '</small></span><span>' . esc_html( sprintf( _n( '%d valeur', '%d valeurs', count( (array) ( $mapping['value_map'] ?? array() ) ), 'constello-dropship-hub' ), count( (array) ( $mapping['value_map'] ?? array() ) ) ) ) . '</span></div>';
            }
            echo '</div>';
            echo '<form method="post" action="' . esc_url( admin_url( 'admin-post.php' ) ) . '" onsubmit="return confirm(\'' . esc_js( __( 'Supprimer toutes les correspondances mémorisées ?', 'constello-dropship-hub' ) ) . '\');"><input type="hidden" name="action" value="' . esc_attr( CDH_Catalog_Settings::ACTION_RESET_MAPPINGS ) . '">';
            wp_nonce_field( CDH_Catalog_Settings::ACTION_RESET_MAPPINGS );
            echo '<button type="submit" class="cdh-action">' . esc_html__( 'Réinitialiser les correspondances', 'constello-dropship-hub' ) . '</button></form>';
        }
        echo '</section>';
    }

    private static function render_pricing_settings( $currency ) {
        $rule = CDH_Pricing_Rules::get_rule();
        $summary = CDH_Pricing_Rules::public_summary();
        if ( isset( $_GET['cdh_pricing_saved'] ) ) {
            echo '<div class="notice notice-success is-dismissible"><p>' . esc_html__( 'Règle de tarification enregistrée.', 'constello-dropship-hub' ) . '</p></div>';
        }
        if ( isset( $_GET['cdh_pricing_error'] ) ) {
            echo '<div class="notice notice-error"><p>' . esc_html__( 'La règle de tarification n’a pas pu être enregistrée. Vérifie qu’elle contient au moins une étape.', 'constello-dropship-hub' ) . '</p></div>';
        }

        echo '<section class="cdh-card cdh-pricing-settings" id="cdh-pricing-settings">';
        echo '<div class="cdh-card-head"><div><span class="cdh-card-eyebrow">TARIFICATION</span><h2>' . esc_html__( 'Règle de prix WooCommerce', 'constello-dropship-hub' ) . '</h2><p>' . esc_html__( 'L’extension importe le coût réel de chaque SKU AliExpress. Constello applique ici votre calcul commercial avant de créer les prix de vente WooCommerce.', 'constello-dropship-hub' ) . '</p></div><span class="cdh-count">v' . esc_html( (string) $summary['version'] ) . '</span></div>';
        echo '<div class="cdh-pricing-flow"><span>' . esc_html__( 'Prix SKU fournisseur', 'constello-dropship-hub' ) . '</span><b>→</b><span>' . esc_html__( 'Étapes de calcul', 'constello-dropship-hub' ) . '</span><b>→</b><span>' . esc_html__( 'Prix WooCommerce', 'constello-dropship-hub' ) . '</span></div>';
        echo '<form method="post" action="' . esc_url( admin_url( 'admin-post.php' ) ) . '" id="cdh-pricing-form">';
        echo '<input type="hidden" name="action" value="' . esc_attr( CDH_Pricing_Rules::ACTION_SAVE ) . '">';
        wp_nonce_field( CDH_Pricing_Rules::ACTION_SAVE );
        echo '<input type="hidden" name="cdh_pricing_rule_json" id="cdh_pricing_rule_json" value="">';
        echo '<div class="cdh-pricing-toolbar"><label><span>' . esc_html__( 'Nom de la règle', 'constello-dropship-hub' ) . '</span><input type="text" id="cdh-rule-name" value="' . esc_attr( $rule['name'] ) . '"></label><button type="button" class="cdh-action" id="cdh-add-step">+ ' . esc_html__( 'Ajouter une étape', 'constello-dropship-hub' ) . '</button></div>';
        echo '<div id="cdh-pricing-steps" class="cdh-pricing-steps"></div>';
        echo '<div class="cdh-pricing-preview-box"><div><span class="cdh-card-eyebrow">APERÇU</span><h3>' . esc_html__( 'Tester la règle', 'constello-dropship-hub' ) . '</h3><p>' . esc_html__( 'Cet aperçu est local à l’écran et ne modifie aucun produit.', 'constello-dropship-hub' ) . '</p></div><label><span>' . esc_html__( 'Prix SKU test', 'constello-dropship-hub' ) . '</span><div class="cdh-money-input"><b>' . esc_html( $currency ) . '</b><input id="cdh-sample-cost" type="number" min="0.01" step="0.01" value="12.00"></div></label><div class="cdh-pricing-result"><small>' . esc_html__( 'Prix final', 'constello-dropship-hub' ) . '</small><strong id="cdh-sample-result">—</strong><span id="cdh-sample-trace"></span></div></div>';
        echo '<div class="cdh-pricing-actions"><button type="submit" class="cdh-action cdh-action-primary">' . esc_html__( 'Enregistrer la règle', 'constello-dropship-hub' ) . '</button><span>' . esc_html__( 'Les produits existants ne sont pas recalculés automatiquement. Utilise « Recalculer » depuis la fiche produit.', 'constello-dropship-hub' ) . '</span></div>';
        echo '</form></section>';

        $json = wp_json_encode( $rule, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES );
        $json = str_replace( '</', '<\\/', (string) $json );
        echo '<script>(function(){';
        echo 'const initial=' . $json . ';const currency=' . wp_json_encode( (string) $currency ) . ';';
        echo <<<'JS'
const root=document.getElementById('cdh-pricing-settings');if(!root)return;
const list=root.querySelector('#cdh-pricing-steps'),add=root.querySelector('#cdh-add-step'),form=root.querySelector('#cdh-pricing-form'),hidden=root.querySelector('#cdh_pricing_rule_json'),nameInput=root.querySelector('#cdh-rule-name'),sample=root.querySelector('#cdh-sample-cost'),result=root.querySelector('#cdh-sample-result'),trace=root.querySelector('#cdh-sample-trace');
let steps=Array.isArray(initial.steps)?initial.steps.map(s=>({...s})):[];
const defs={multiply:['Coefficient','×',1.5],add_fixed:['Ajouter un montant','+',4],subtract_fixed:['Retirer un montant','−',1],add_percent:['Ajouter un pourcentage','+ %',5],subtract_percent:['Retirer un pourcentage','− %',5],target_margin:['Marge cible','%',40],min_margin:['Marge minimale','≥ %',30],minimum:['Prix minimum','≥',10],maximum:['Prix maximum','≤',999],psychological:['Prix psychologique','',0]};
function id(){return 's'+Math.random().toString(36).slice(2)+Date.now().toString(36)}
function escapeHtml(v){const d=document.createElement('div');d.textContent=String(v??'');return d.innerHTML}
function psych(price,suffix,mode){price=Math.max(0,price);const f=Math.floor(price),same=f+suffix,prev=Math.max(0,f-1+suffix),next=f+1+suffix;if(mode==='up')return price<=same?same:next;if(mode==='down')return price>=same?same:prev;return [prev,same,next].sort((a,b)=>Math.abs(price-a)-Math.abs(price-b)||b-a)[0]}
function calculate(cost){let v=Number(cost)||0;const parts=[];for(const s of steps){if(s.enabled===false)continue;const before=v,n=Number(s.value)||0;switch(s.type){case'multiply':if(n>0)v*=n;break;case'add_fixed':v+=n;break;case'subtract_fixed':v-=n;break;case'add_percent':v*=1+n/100;break;case'subtract_percent':v*=1-n/100;break;case'target_margin':if(n>0&&n<100)v=cost/(1-n/100);break;case'min_margin':if(n>0&&n<100)v=Math.max(v,cost/(1-n/100));break;case'minimum':if(n>0)v=Math.max(v,n);break;case'maximum':if(n>0)v=Math.min(v,n);break;case'psychological':v=psych(v,Number(s.suffix??.9),s.mode||'nearest');break;}v=Math.max(0,v);parts.push(`${before.toFixed(2)} → ${v.toFixed(2)}`)}return{value:v,parts}}
function syncPreview(){const c=Number(sample.value)||0;if(!(c>0)||!steps.some(s=>s.enabled!==false)){result.textContent='—';trace.textContent='';return}const out=calculate(c);result.textContent=`${currency} ${out.value.toFixed(2)}`;trace.textContent=out.parts.join(' · ')}
function render(){list.innerHTML='';steps.forEach((s,i)=>{const row=document.createElement('div');row.className='cdh-pricing-step'+(s.enabled===false?' is-disabled':'');const options=Object.entries(defs).map(([k,d])=>`<option value="${k}"${s.type===k?' selected':''}>${escapeHtml(d[0])}</option>`).join('');row.innerHTML=`<label class="cdh-step-enabled"><input type="checkbox" ${s.enabled===false?'':'checked'} aria-label="Activer l’étape"></label><span class="cdh-step-index">${i+1}</span><select class="cdh-step-type">${options}</select><div class="cdh-step-value"></div><div class="cdh-step-controls"><button type="button" data-act="up" title="Monter">↑</button><button type="button" data-act="down" title="Descendre">↓</button><button type="button" data-act="del" title="Supprimer">×</button></div>`;const val=row.querySelector('.cdh-step-value');if(s.type==='psychological'){val.innerHTML=`<select class="cdh-step-suffix"><option value="0.9">.90</option><option value="0.95">.95</option><option value="0.99">.99</option><option value="0.5">.50</option><option value="0">.00</option></select><select class="cdh-step-mode"><option value="nearest">Au plus proche</option><option value="up">Toujours vers le haut</option><option value="down">Toujours vers le bas</option></select>`;val.querySelector('.cdh-step-suffix').value=String(Number(s.suffix??.9));val.querySelector('.cdh-step-mode').value=s.mode||'nearest';}else{const symbol=defs[s.type]?.[1]||'';val.innerHTML=`<span>${escapeHtml(symbol)}</span><input class="cdh-step-number" type="number" step="0.01" value="${escapeHtml(s.value??defs[s.type]?.[2]??0)}">`;}row.querySelector('.cdh-step-enabled input').addEventListener('change',e=>{s.enabled=e.target.checked;render();});row.querySelector('.cdh-step-type').addEventListener('change',e=>{s.type=e.target.value;s.value=defs[s.type]?.[2]??0;if(s.type==='psychological'){s.suffix=.9;s.mode='nearest'}render();});const num=val.querySelector('.cdh-step-number');if(num)num.addEventListener('input',e=>{s.value=Number(e.target.value)||0;syncPreview();});const suf=val.querySelector('.cdh-step-suffix');if(suf)suf.addEventListener('change',e=>{s.suffix=Number(e.target.value);syncPreview();});const mode=val.querySelector('.cdh-step-mode');if(mode)mode.addEventListener('change',e=>{s.mode=e.target.value;syncPreview();});row.querySelectorAll('[data-act]').forEach(b=>b.addEventListener('click',()=>{const a=b.dataset.act;if(a==='del')steps.splice(i,1);if(a==='up'&&i>0)[steps[i-1],steps[i]]=[steps[i],steps[i-1]];if(a==='down'&&i<steps.length-1)[steps[i+1],steps[i]]=[steps[i],steps[i+1]];render();}));list.appendChild(row)});syncPreview()}
add.addEventListener('click',()=>{steps.push({id:id(),type:'multiply',value:1.5,enabled:true});render()});sample.addEventListener('input',syncPreview);form.addEventListener('submit',e=>{if(!steps.length){e.preventDefault();alert('Ajoute au moins une étape de calcul.');return}hidden.value=JSON.stringify({configured:true,name:nameInput.value.trim()||'Règle par défaut',steps});});render();
JS;
        echo '})();</script>';
    }

}
