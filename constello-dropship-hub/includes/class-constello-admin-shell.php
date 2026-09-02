<?php
/**
 * Transitional Constello admin shell.
 *
 * This class is deliberately generic and filter-driven so it can be extracted into
 * constello-core later without changing application routes. Other Constello apps can
 * register themselves on `constello_admin_apps` while this bootstrap is present.
 *
 * @package ConstelloSmartIndex
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

if ( ! class_exists( 'Constello_Admin_Shell' ) ) {
	class Constello_Admin_Shell {
		const PARENT_SLUG = 'constello-app';
		private static $booted = false;
		private static $notification_cache = null;

		public static function init() {
			if ( self::$booted ) {
				return;
			}
			self::$booted = true;
			add_action( 'admin_menu', array( __CLASS__, 'menu' ), 20 );
			add_action( 'admin_enqueue_scripts', array( __CLASS__, 'assets' ), 1 );
			add_filter( 'admin_body_class', array( __CLASS__, 'body_class' ) );
			add_filter( 'parent_file', array( __CLASS__, 'parent_file' ) );
			add_filter( 'submenu_file', array( __CLASS__, 'submenu_file' ) );
			add_action( 'admin_post_constello_set_theme', array( __CLASS__, 'set_theme' ) );
		}

		/**
		 * @return array<string,array>
		 */
		public static function apps() {
			$apps = apply_filters( 'constello_admin_apps', array() );
			if ( ! is_array( $apps ) ) {
				return array();
			}
			uasort(
				$apps,
				static function ( $a, $b ) {
					return (int) ( $a['order'] ?? 50 ) <=> (int) ( $b['order'] ?? 50 );
				}
			);
			return $apps;
		}

		/**
		 * Actionable notifications published by installed Constello applications.
		 * The Constello overview is the authority; menu/header badges are projections.
		 *
		 * @return array<int,array>
		 */
		public static function notifications() {
			if ( is_array( self::$notification_cache ) ) {
				return self::$notification_cache;
			}
			$items = apply_filters( 'constello_admin_notifications', array() );
			if ( ! is_array( $items ) ) {
				return array();
			}

			$apps       = self::apps();
			$normalized = array();
			foreach ( $items as $item ) {
				if ( ! is_array( $item ) || empty( $item['app_id'] ) || empty( $item['title'] ) ) {
					continue;
				}
				$app_id = sanitize_key( $item['app_id'] );
				if ( ! isset( $apps[ $app_id ] ) ) {
					continue;
				}
				$id = ! empty( $item['id'] ) ? sanitize_key( $item['id'] ) : sanitize_key( md5( $item['title'] . '|' . ( $item['url'] ?? '' ) ) );
				$key = $app_id . ':' . $id;
				$severity = in_array( $item['severity'] ?? 'warn', array( 'warn', 'error' ), true ) ? $item['severity'] : 'warn';
				$normalized[ $key ] = array(
					'id'           => $id,
					'app_id'       => $app_id,
					'app_name'     => $apps[ $app_id ]['name'],
					'severity'     => $severity,
					'title'        => wp_strip_all_tags( (string) $item['title'] ),
					'message'      => isset( $item['message'] ) ? wp_strip_all_tags( (string) $item['message'] ) : '',
					'action_label' => isset( $item['action_label'] ) ? wp_strip_all_tags( (string) $item['action_label'] ) : '',
					'url'          => isset( $item['url'] ) ? esc_url_raw( $item['url'] ) : '',
				);
			}
			self::$notification_cache = array_values( $normalized );
			return self::$notification_cache;
		}

		/** @return array<int,array> */
		public static function notifications_for_app( $app_id ) {
			$app_id = sanitize_key( $app_id );
			return array_values(
				array_filter(
					self::notifications(),
					static function ( $item ) use ( $app_id ) {
						return $item['app_id'] === $app_id;
					}
				)
			);
		}

		/**
		 * @param array|null $notifications Optional preloaded registry.
		 * @return array{total:int,apps:array<string,int>}
		 */
		public static function notification_counts( $notifications = null ) {
			$notifications = is_array( $notifications ) ? $notifications : self::notifications();
			$counts = array( 'total' => count( $notifications ), 'apps' => array() );
			foreach ( $notifications as $item ) {
				$app_id = $item['app_id'];
				$counts['apps'][ $app_id ] = isset( $counts['apps'][ $app_id ] ) ? $counts['apps'][ $app_id ] + 1 : 1;
			}
			return $counts;
		}

		private static function menu_label( $label, $count = 0 ) {
			$label = esc_html( $label );
			if ( $count < 1 ) {
				return $label;
			}
			return $label . ' <span class="update-plugins count-' . (int) $count . '"><span class="plugin-count">' . (int) $count . '</span></span>';
		}

		public static function menu() {
			$cap           = 'manage_woocommerce';
			$notifications = self::notifications();
			$counts        = self::notification_counts( $notifications );

			add_menu_page(
				__( 'Constello App', 'constello-smart-index' ),
				self::menu_label( __( 'Constello App', 'constello-smart-index' ), $counts['total'] ),
				$cap,
				self::PARENT_SLUG,
				array( __CLASS__, 'render_overview' ),
				'none',
				56
			);
			add_submenu_page(
				self::PARENT_SLUG,
				__( 'Overview', 'constello-smart-index' ),
				__( 'Overview', 'constello-smart-index' ),
				$cap,
				self::PARENT_SLUG,
				array( __CLASS__, 'render_overview' )
			);

			foreach ( self::apps() as $app ) {
				$routes = isset( $app['routes'] ) && is_array( $app['routes'] ) ? array_values( $app['routes'] ) : array();
				if ( empty( $routes ) ) {
					continue;
				}
				$app_cap   = $app['capability'] ?? $cap;
				$root      = $routes[0];
				$app_count = $counts['apps'][ $app['id'] ] ?? 0;
				add_submenu_page(
					self::PARENT_SLUG,
					$app['name'],
					self::menu_label( $app['name'], $app_count ),
					$app_cap,
					$root['slug'],
					$root['callback']
				);

				// Secondary application routes stay registered with WordPress for capability
				// checks and screen hooks, but they are intentionally hidden from the native
				// sidebar. The Constello app tabs own detailed navigation.
				foreach ( array_slice( $routes, 1 ) as $route ) {
					add_submenu_page(
						null,
						$route['label'],
						$route['label'],
						$app_cap,
						$route['slug'],
						$route['callback']
					);
				}

			}
		}

		public static function assets() {
			if ( ! current_user_can( 'manage_woocommerce' ) && ! current_user_can( 'manage_options' ) ) {
				return;
			}
			wp_enqueue_style( 'constello-admin-shell', CDH_URL . 'assets/constello-shell.css', array(), CDH_VERSION );
			wp_enqueue_script( 'constello-admin-shell', CDH_URL . 'assets/constello-shell.js', array(), CDH_VERSION, true );
		}

		public static function current_page_slug() {
			return isset( $_GET['page'] ) ? sanitize_key( wp_unslash( $_GET['page'] ) ) : ''; // phpcs:ignore WordPress.Security.NonceVerification.Recommended
		}

		public static function app_for_page( $page = '' ) {
			$page = $page ? $page : self::current_page_slug();
			foreach ( self::apps() as $app ) {
				foreach ( (array) ( $app['routes'] ?? array() ) as $route ) {
					if ( $page === $route['slug'] ) {
						return $app;
					}
				}
			}
			return null;
		}

		public static function route_for_page( $app, $page = '' ) {
			$page = $page ? $page : self::current_page_slug();
			foreach ( (array) ( $app['routes'] ?? array() ) as $route ) {
				if ( $page === $route['slug'] ) {
					return $route;
				}
			}
			return null;
		}

		public static function is_constello_screen() {
			$page = self::current_page_slug();
			return self::PARENT_SLUG === $page || null !== self::app_for_page( $page );
		}

		public static function body_class( $classes ) {
			if ( ! self::is_constello_screen() ) {
				return $classes;
			}
			$mode = self::theme_mode();
			return $classes . ' ct-admin ct-app-screen ct-theme-' . $mode . ( self::PARENT_SLUG === self::current_page_slug() ? ' ct-constello-home' : '' );
		}

		public static function theme_mode() {
			$mode = get_user_meta( get_current_user_id(), 'constello_theme', true );
			if ( ! in_array( $mode, array( 'system', 'light', 'dark' ), true ) ) {
				$mode = 'system';
			}
			return apply_filters( 'constello_theme_mode', $mode, get_current_user_id() );
		}

		public static function set_theme() {
			if ( ! current_user_can( 'manage_woocommerce' ) && ! current_user_can( 'manage_options' ) ) {
				wp_die( esc_html__( 'Access denied.', 'constello-smart-index' ) );
			}
			check_admin_referer( 'constello_set_theme' );
			$mode = isset( $_GET['mode'] ) ? sanitize_key( wp_unslash( $_GET['mode'] ) ) : 'system';
			if ( ! in_array( $mode, array( 'system', 'light', 'dark' ), true ) ) {
				$mode = 'system';
			}
			update_user_meta( get_current_user_id(), 'constello_theme', $mode );
			$return = wp_get_referer();
			wp_safe_redirect( $return ? $return : admin_url( 'admin.php?page=' . self::PARENT_SLUG ) );
			exit;
		}

		public static function parent_file( $parent_file ) {
			return self::app_for_page() ? self::PARENT_SLUG : $parent_file;
		}

		public static function submenu_file( $submenu_file ) {
			$app = self::app_for_page();
			if ( ! $app ) {
				return $submenu_file;
			}
			$routes = isset( $app['routes'] ) && is_array( $app['routes'] ) ? array_values( $app['routes'] ) : array();
			return ! empty( $routes[0]['slug'] ) ? $routes[0]['slug'] : $submenu_file;
		}


		/**
		 * Presentation-only license summary for the Constello hub.
		 * Future constello-core/licensing code can override this payload without
		 * coupling the shell to one billing provider.
		 *
		 * @return array
		 */
		public static function license_summary() {
			$provider = class_exists( 'CSI_Plugin' ) ? CSI_Plugin::license() : null;
			$tier     = $provider && method_exists( $provider, 'get_tier' ) ? sanitize_key( $provider->get_tier() ) : 'free';
			$label    = $tier ? ucfirst( $tier ) : __( 'Current plan', 'constello-smart-index' );
			$summary  = array(
				'plan_label'      => sprintf( __( 'Constello %s', 'constello-smart-index' ), $label ),
				'status'          => 'active',
				'status_label'    => __( 'Active', 'constello-smart-index' ),
				'activated_count' => count( self::apps() ),
				'included_count'  => null,
				'manage_url'      => '',
			);
			$summary = apply_filters( 'constello_admin_license_summary', $summary, $provider );
			return is_array( $summary ) ? $summary : array();
		}

		/**
		 * Catalogue entries shown by the Constello hub.
		 * `license_state=included` plus an `activate_url` turns a catalogue card into
		 * an activation card. The default entries are discovery-only so this shell
		 * never invents an entitlement that the licensing backend has not granted.
		 *
		 * @return array<int,array>
		 */
		public static function catalog_apps() {
			$catalog = array(
				array(
					'id'            => 'tracking',
					'name'          => 'Tracking',
					'icon'          => 'truck',
					'tone'          => 'cyan',
					'tagline'       => __( 'Stay ahead of every delivery.', 'constello-smart-index' ),
					'description'   => __( 'Track parcels, detect delays and incidents, inform customers and keep shipment history in one place.', 'constello-smart-index' ),
					'features'      => array( __( 'Multi-carrier tracking', 'constello-smart-index' ), __( 'Delays and incidents', 'constello-smart-index' ), __( 'Customer notifications', 'constello-smart-index' ), __( 'Shipment history', 'constello-smart-index' ) ),
					'license_state' => 'discover',
					'discover_url'  => 'https://constello.ch/',
				),
				array(
					'id'            => 'smart-pay',
					'name'          => 'Smart Pay',
					'icon'          => 'credit-card',
					'tone'          => 'violet',
					'tagline'       => __( 'Centralize payments and automate reconciliation.', 'constello-smart-index' ),
					'description'   => __( 'Connect payment providers, follow transactions and refunds, and surface reconciliation differences that need attention.', 'constello-smart-index' ),
					'features'      => array( __( 'Multi-PSP', 'constello-smart-index' ), __( 'Transactions', 'constello-smart-index' ), __( 'Refunds', 'constello-smart-index' ), __( 'Reconciliation', 'constello-smart-index' ) ),
					'license_state' => 'discover',
					'discover_url'  => 'https://constello.ch/',
				),
				array(
					'id'            => 'rma',
					'name'          => 'RMA',
					'icon'          => 'package',
					'tone'          => 'orange',
					'tagline'       => __( 'Structure returns and after-sales service.', 'constello-smart-index' ),
					'description'   => __( 'Manage return requests, follow every workflow step and keep reception and after-sales follow-up in one place.', 'constello-smart-index' ),
					'features'      => array( __( 'Return requests', 'constello-smart-index' ), __( 'RMA workflow', 'constello-smart-index' ), __( 'Product reception', 'constello-smart-index' ), __( 'After-sales follow-up', 'constello-smart-index' ) ),
					'license_state' => 'discover',
					'discover_url'  => 'https://constello.ch/',
				),
			);
			$catalog = apply_filters( 'constello_admin_catalog_apps', $catalog, self::license_summary() );
			if ( ! is_array( $catalog ) ) {
				return array();
			}
			$installed = array_keys( self::apps() );
			return array_values(
				array_filter(
					$catalog,
					static function ( $item ) use ( $installed ) {
						return is_array( $item ) && ! empty( $item['id'] ) && ! in_array( sanitize_key( $item['id'] ), $installed, true );
					}
				)
			);
		}

		public static function render_overview() {
			if ( ! current_user_can( 'manage_woocommerce' ) && ! current_user_can( 'manage_options' ) ) {
				wp_die( esc_html__( 'Access denied.', 'constello-smart-index' ) );
			}
			$notifications = self::notifications();
			$counts        = self::notification_counts( $notifications );
			$license       = self::license_summary();
			$catalog       = self::catalog_apps();
			$included      = array_values( array_filter( $catalog, static function ( $item ) { return 'included' === ( $item['license_state'] ?? '' ); } ) );
			$discover      = array_values( array_filter( $catalog, static function ( $item ) { return 'included' !== ( $item['license_state'] ?? '' ); } ) );

			echo '<div class="ct-app-shell ct-platform-hub">';
			echo '<div class="ct-page-header ct-platform-header"><div class="ct-page-title-row"><span class="ct-page-icon ct-page-icon-brand">' . self::icon( 'constello-mark' ) . '</span><div class="ct-platform-brand"><h1 class="ct-platform-brand-name">CONSTELLO</h1><p class="ct-platform-brand-subtitle">' . esc_html__( 'Smart App Shell', 'constello-smart-index' ) . '</p><p class="ct-page-lead">' . esc_html__( 'Manage your applications and license, and discover available services designed to grow your business.', 'constello-smart-index' ) . '</p></div></div><div class="ct-page-actions">' . self::alert_center( array( 'alerts' => $notifications ) ) . self::theme_switcher() . '</div></div>';

			$plan_label      = isset( $license['plan_label'] ) ? (string) $license['plan_label'] : __( 'Constello', 'constello-smart-index' );
			$status_label    = isset( $license['status_label'] ) ? (string) $license['status_label'] : __( 'Active', 'constello-smart-index' );
			$activated_count = isset( $license['activated_count'] ) ? (int) $license['activated_count'] : count( self::apps() );
			$included_count  = isset( $license['included_count'] ) && null !== $license['included_count'] ? (int) $license['included_count'] : null;
			$manage_url      = ! empty( $license['manage_url'] ) ? esc_url( $license['manage_url'] ) : '';
			echo '<section class="ct-license-summary" aria-label="' . esc_attr__( 'Constello license', 'constello-smart-index' ) . '"><div class="ct-license-main"><span class="ct-license-icon">' . self::icon( 'shield' ) . '</span><div><p class="ct-eyebrow">' . esc_html__( 'Your license', 'constello-smart-index' ) . '</p><div class="ct-license-plan-row"><h2>' . esc_html( $plan_label ) . '</h2><span class="ct-license-state">' . esc_html( $status_label ) . '</span></div></div></div><div class="ct-license-stat"><b>' . (int) $activated_count . '</b><span>' . esc_html( _n( 'active application', 'active applications', $activated_count, 'constello-smart-index' ) ) . '</span></div>';
			if ( null !== $included_count ) {
				echo '<div class="ct-license-stat"><b>' . (int) $included_count . '</b><span>' . esc_html( _n( 'application included', 'applications included', $included_count, 'constello-smart-index' ) ) . '</span></div>';
			}
			if ( $manage_url ) {
				echo '<a class="ct-hub-button ct-hub-button-secondary" href="' . $manage_url . '">' . esc_html__( 'Manage license', 'constello-smart-index' ) . self::icon( 'chevron-right' ) . '</a>';
			}
			echo '</section>';

			echo '<section class="ct-hub-section"><div class="ct-hub-section-head"><div><h2>' . esc_html__( 'My applications', 'constello-smart-index' ) . '</h2><p>' . esc_html__( 'Your active Constello applications and their current operational state.', 'constello-smart-index' ) . '</p></div></div><div class="ct-hub-installed-list">';
			foreach ( self::apps() as $app ) {
				$root = $app['routes'][0] ?? null;
				if ( ! $root ) {
					continue;
				}
				$app_count = $counts['apps'][ $app['id'] ] ?? 0;
				$overview  = array();
				if ( ! empty( $app['overview_callback'] ) && is_callable( $app['overview_callback'] ) ) {
					$overview = (array) call_user_func( $app['overview_callback'] );
				}
				$state = $app_count ? 'attention' : sanitize_key( $overview['state'] ?? 'ok' );
				if ( ! in_array( $state, array( 'ok', 'attention', 'critical' ), true ) ) {
					$state = 'ok';
				}
				$state_label = $overview['state_label'] ?? ( 'ok' === $state ? __( 'Operational', 'constello-smart-index' ) : __( 'Attention', 'constello-smart-index' ) );
				$tagline     = $app['tagline'] ?? '';
				$features    = ! empty( $app['features'] ) && is_array( $app['features'] ) ? array_slice( $app['features'], 0, 4 ) : array();
				echo '<article class="ct-hub-installed ct-hub-installed-' . esc_attr( $state ) . '"><span class="ct-hub-installed-icon">' . self::icon( $app['icon'] ?? 'grid' ) . '</span><div class="ct-hub-installed-main"><div class="ct-hub-installed-title-row"><div class="ct-hub-installed-heading"><h3>' . esc_html( $app['name'] ) . '</h3><span class="ct-hub-license-active">' . self::icon( 'check-circle' ) . esc_html__( 'License active', 'constello-smart-index' ) . '</span></div><span class="ct-app-card-state">' . self::icon( 'ok' === $state ? 'check-circle' : ( 'critical' === $state ? 'x-circle' : 'alert-triangle' ) ) . esc_html( $state_label );
				if ( $app_count ) {
					echo ' <b>' . (int) $app_count . '</b>';
				}
				echo '</span></div>';
				if ( $tagline ) {
					echo '<strong class="ct-hub-tagline">' . esc_html( $tagline ) . '</strong>';
				}
				echo '<p class="ct-hub-description">' . esc_html( $app['description'] ?? '' ) . '</p>';
				if ( $features ) {
					echo '<div class="ct-hub-features">';
					foreach ( $features as $feature ) {
						echo '<span>' . self::icon( 'check-circle' ) . esc_html( $feature ) . '</span>';
					}
					echo '</div>';
				}
				if ( ! empty( $overview['metrics'] ) && is_array( $overview['metrics'] ) ) {
					echo '<div class="ct-hub-metrics">';
					foreach ( array_slice( $overview['metrics'], 0, 3 ) as $metric ) {
						echo '<span><b>' . esc_html( (string) ( $metric['value'] ?? '' ) ) . '</b><small>' . esc_html( (string) ( $metric['label'] ?? '' ) ) . '</small></span>';
					}
					echo '</div>';
				}
				echo '</div><div class="ct-hub-installed-action"><a class="ct-hub-button ct-hub-button-primary" href="' . esc_url( admin_url( 'admin.php?page=' . $root['slug'] ) ) . '">' . esc_html( sprintf( __( 'Open %s', 'constello-smart-index' ), $app['name'] ) ) . self::icon( 'chevron-right' ) . '</a></div></article>';
			}
			echo '</div></section>';

			if ( $included ) {
				echo '<section class="ct-hub-section"><div class="ct-hub-section-head"><div><h2>' . esc_html__( 'Available with your license', 'constello-smart-index' ) . '</h2><p>' . esc_html__( 'These applications are included in your offer and ready to be activated.', 'constello-smart-index' ) . '</p></div></div><div class="ct-hub-available-list">';
				foreach ( $included as $item ) {
					self::render_catalog_card( $item, true );
				}
				echo '</div></section>';
			}

			if ( $discover ) {
				echo '<section class="ct-hub-section"><div class="ct-hub-section-head"><div><h2>' . esc_html__( 'Discover Constello', 'constello-smart-index' ) . '</h2><p>' . esc_html__( 'Complementary applications to automate more of your operations from the same environment.', 'constello-smart-index' ) . '</p></div></div><div class="ct-hub-catalog-grid">';
				foreach ( $discover as $item ) {
					self::render_catalog_card( $item, false );
				}
				echo '</div></section>';
			}
			echo '</div>';
		}

		/** Render one filter-driven catalogue card. */
		private static function render_catalog_card( $item, $included = false ) {
			$name        = isset( $item['name'] ) ? (string) $item['name'] : '';
			$tagline     = isset( $item['tagline'] ) ? (string) $item['tagline'] : '';
			$description = isset( $item['description'] ) ? (string) $item['description'] : '';
			$features    = ! empty( $item['features'] ) && is_array( $item['features'] ) ? array_slice( $item['features'], 0, 4 ) : array();
			$icon        = ! empty( $item['icon'] ) ? sanitize_key( $item['icon'] ) : 'grid';
			$tone        = ! empty( $item['tone'] ) ? sanitize_key( $item['tone'] ) : 'cyan';
			$url         = $included && ! empty( $item['activate_url'] ) ? esc_url( $item['activate_url'] ) : ( ! empty( $item['discover_url'] ) ? esc_url( $item['discover_url'] ) : '' );
			$label       = $included ? __( 'Activate', 'constello-smart-index' ) : sprintf( __( 'Discover %s', 'constello-smart-index' ), $name );
			echo '<article class="ct-hub-catalog-card ct-hub-tone-' . esc_attr( $tone ) . '"><div class="ct-hub-catalog-top"><span class="ct-hub-catalog-icon">' . self::icon( $icon ) . '</span><div><h3>' . esc_html( $name ) . '</h3>';
			if ( $tagline ) {
				echo '<strong>' . esc_html( $tagline ) . '</strong>';
			}
			echo '</div>';
			if ( $included ) {
				echo '<span class="ct-hub-included">' . self::icon( 'check-circle' ) . esc_html__( 'Included in your offer', 'constello-smart-index' ) . '</span>';
			}
			echo '</div><p>' . esc_html( $description ) . '</p>';
			if ( $features ) {
				echo '<div class="ct-hub-catalog-features">';
				foreach ( $features as $feature ) {
					echo '<span>' . esc_html( $feature ) . '</span>';
				}
				echo '</div>';
			}
			if ( $url ) {
				echo '<a class="ct-hub-catalog-action" href="' . $url . '"' . ( $included ? '' : ' target="_blank" rel="noopener noreferrer"' ) . '>' . esc_html( $label ) . self::icon( 'chevron-right' ) . '</a>';
			} elseif ( $included ) {
				echo '<span class="ct-hub-catalog-pending">' . esc_html__( 'Activation will be available when the license service provides an activation link.', 'constello-smart-index' ) . '</span>';
			}
			echo '</article>';
		}

		public static function app_header( $app_id, $title, $lead, $status = null, $layout = 'default' ) {
			$app = self::apps()[ $app_id ] ?? null;
			if ( ! $app ) {
				return;
			}
			// The Constello overview/registry is the notification authority. The
			// optional status parameter is kept only for transition compatibility.
			$status  = array( 'alerts' => self::notifications_for_app( $app_id ) );
			$current = self::current_page_slug();
			$layout  = 'nav-first' === $layout ? 'nav-first' : 'default';
			echo '<div class="ct-app-shell csi-wrap' . ( 'nav-first' === $layout ? ' ct-layout-nav-first' : '' ) . '">';
			$header_name = ! empty( $app['header_name'] ) ? (string) $app['header_name'] : (string) $app['name'];

			if ( 'nav-first' === $layout ) {
				echo '<div class="ct-app-masthead">';
				echo '<div class="ct-app-identity"><span class="ct-page-icon">' . self::icon( $app['icon'] ?? 'grid' ) . '</span><p class="ct-eyebrow">' . esc_html( $header_name ) . '</p></div>';
				echo '</div>';
			} else {
				echo '<div class="ct-page-header">';
				echo '<div class="ct-page-title-row"><span class="ct-page-icon">' . self::icon( $app['icon'] ?? 'grid' ) . '</span><div><p class="ct-eyebrow">' . esc_html( $header_name ) . '</p><h1>' . esc_html( $title ) . '</h1><p class="ct-page-lead">' . esc_html( $lead ) . '</p></div></div>';
				echo '<div class="ct-page-actions">';
				echo '<span class="ct-live-alert-slot">' . self::alert_center( $status ) . '</span>';
				echo self::theme_switcher();
				echo '</div></div>';
			}

			$current_route = self::route_for_page( $app, $current );
			$current_top_id = ! empty( $current_route['parent'] ) ? (string) $current_route['parent'] : (string) ( $current_route['id'] ?? '' );
			echo '<nav class="ct-app-tabs' . ( 'nav-first' === $layout ? ' ct-app-tabs-with-actions' : '' ) . '" aria-label="' . esc_attr( $app['name'] ) . '">';
			echo '<div class="ct-app-tab-links">';
			foreach ( (array) $app['routes'] as $route ) {
				if ( ! empty( $route['parent'] ) ) {
					continue;
				}
				$active = $current_top_id === (string) ( $route['id'] ?? '' );
				echo '<a class="ct-app-tab' . ( $active ? ' is-active' : '' ) . '" href="' . esc_url( admin_url( 'admin.php?page=' . $route['slug'] ) ) . '">' . self::icon( $route['icon'] ?? 'circle' ) . '<span>' . esc_html( $route['label'] ) . '</span></a>';
			}
			echo '</div>';
			if ( 'nav-first' === $layout ) {
				echo '<div class="ct-app-tab-actions">';
				echo '<span class="ct-live-alert-slot">' . self::alert_center( $status ) . '</span>';
				echo self::theme_switcher();
				echo '</div>';
			}
			echo '</nav>';

			if ( 'nav-first' === $layout ) {
				echo '<div class="ct-page-context"><h1>' . esc_html( $title ) . '</h1><p class="ct-page-lead">' . esc_html( $lead ) . '</p></div>';
			}
		}

		/**
		 * Compact application alert center. Applications pass only actionable items.
		 *
		 * @param array|null $status Status payload with an alerts array.
		 * @return string
		 */
		public static function alert_center( $status = null ) {
			$alerts = is_array( $status ) && ! empty( $status['alerts'] ) && is_array( $status['alerts'] ) ? array_values( $status['alerts'] ) : array();
			$count  = count( $alerts );
			if ( ! $count ) {
				return '';
			}

			$out  = '<div class="ct-alert-center">';
			$out .= '<button type="button" class="ct-alert-trigger" aria-expanded="false" aria-haspopup="dialog" aria-label="' . esc_attr__( 'Action required', 'constello-smart-index' ) . '" title="' . esc_attr__( 'Action required', 'constello-smart-index' ) . '">' . self::icon( 'alert-triangle' ) . '<span class="ct-alert-count">' . (int) $count . '</span></button>';
			$out .= '<div class="ct-alert-panel" role="dialog" aria-label="' . esc_attr__( 'Action required', 'constello-smart-index' ) . '" hidden>';
			$out .= '<div class="ct-alert-panel-head"><strong>' . esc_html__( 'Action required', 'constello-smart-index' ) . '</strong><button type="button" class="ct-alert-close" aria-label="' . esc_attr__( 'Close', 'constello-smart-index' ) . '">' . self::icon( 'x' ) . '</button></div>';
			$out .= '<div class="ct-alert-list">';
			foreach ( $alerts as $alert ) {
				$severity = in_array( $alert['severity'] ?? 'warn', array( 'warn', 'error' ), true ) ? $alert['severity'] : 'warn';
				$has_action = ! empty( $alert['url'] ) && ! empty( $alert['action_label'] );
				$tag = $has_action ? 'a' : 'div';
				$href = $has_action ? ' href="' . esc_url( $alert['url'] ) . '"' : '';
				$out .= '<' . $tag . ' class="ct-alert-item ct-alert-item-' . esc_attr( $severity ) . ( $has_action ? ' is-actionable' : '' ) . '"' . $href . '><span class="ct-alert-item-icon">' . self::icon( 'error' === $severity ? 'x-circle' : 'alert-triangle' ) . '</span><div class="ct-alert-item-body"><strong>' . esc_html( $alert['title'] ?? '' ) . '</strong>';
				if ( ! empty( $alert['message'] ) ) {
					$out .= '<p>' . esc_html( $alert['message'] ) . '</p>';
				}
				if ( $has_action ) {
					$out .= '<span class="ct-alert-action">' . esc_html( $alert['action_label'] ) . self::icon( 'chevron-right' ) . '</span>';
				}
				$out .= '</div></' . $tag . '>';
			}
			$out .= '</div></div></div>';
			return $out;
		}

		/**
		 * Contextual help trigger used by Constello cards and settings.
		 *
		 * @param string $title Help title.
		 * @param string $body Help body.
		 * @param string $recommendation Optional recommendation.
		 * @return string
		 */
		public static function help_trigger( $title, $body, $recommendation = '' ) {
			$out  = '<span class="ct-help">';
			$out .= '<button type="button" class="ct-info-trigger" aria-expanded="false" aria-label="' . esc_attr( $title ) . '">' . self::icon( 'info-circle' ) . '</button>';
			$out .= '<span class="ct-help-popover" role="dialog" hidden><strong>' . esc_html( $title ) . '</strong><span>' . esc_html( $body ) . '</span>';
			if ( $recommendation ) {
				$out .= '<em>' . esc_html( $recommendation ) . '</em>';
			}
			$out .= '</span></span>';
			return $out;
		}

		public static function theme_switcher() {
			$current = self::theme_mode();
			$out = '<div class="ct-theme-switch ct-theme-switch-compact" data-current-theme="' . esc_attr( $current ) . '" aria-label="' . esc_attr__( 'Constello theme', 'constello-smart-index' ) . '">';
			$modes = array(
				'system' => array( __( 'System', 'constello-smart-index' ), 'monitor' ),
				'light'  => array( __( 'Light', 'constello-smart-index' ), 'sun' ),
				'dark'   => array( __( 'Dark', 'constello-smart-index' ), 'moon' ),
			);
			foreach ( $modes as $mode => $meta ) {
				$url = wp_nonce_url( admin_url( 'admin-post.php?action=constello_set_theme&mode=' . $mode ), 'constello_set_theme' );
				$out .= '<a class="ct-theme-choice' . ( $current === $mode ? ' is-active' : '' ) . '" data-theme-choice="' . esc_attr( $mode ) . '" href="' . esc_url( $url ) . '" title="' . esc_attr( $meta[0] ) . '" aria-label="' . esc_attr( $meta[0] ) . '">' . self::icon( $meta[1] ) . '</a>';
			}
			return $out . '</div>';
		}

		/**
		 * Minimal inline SVG icon library. All icons inherit currentColor.
		 */
		public static function icon( $name ) {
			$brand_icons = array(
				'constello-mark' => 'ct-icon-constello-mark',
				'smart-index'    => 'ct-icon-smart-index-mark',
			);
			if ( isset( $brand_icons[ $name ] ) ) {
				return '<span class="ct-icon ct-icon-brand ' . esc_attr( $brand_icons[ $name ] ) . '" aria-hidden="true"></span>';
			}
			$icons = array(
				'grid'           => '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
				'search'         => '<circle cx="11" cy="11" r="7"/><path d="m20 20-4.2-4.2"/><path d="M8 11h6M11 8v6"/>',
				'clock'          => '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
				'check-circle'   => '<circle cx="12" cy="12" r="9"/><path d="m8 12 2.5 2.5L16 9"/>',
				'x-circle'       => '<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6M15 9l-6 6"/>',
				'trend'          => '<path d="M3 17l6-6 4 4 7-8"/><path d="M15 7h5v5"/>',
				'alert-triangle' => '<path d="M12 3 2.8 20h18.4L12 3Z"/><path d="M12 9v5M12 17h.01"/>',
				'bell'           => '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/>',
				'hourglass'      => '<path d="M6 3h12M6 21h12M8 3c0 5 3 6 4 9-1 3-4 4-4 9M16 3c0 5-3 6-4 9 1 3 4 4 4 9"/>',
				'activity'       => '<path d="M3 12h4l2-6 4 12 2-6h6"/>',
				'bar-chart'      => '<path d="M4 20V11h4v9M10 20V4h4v16M16 20v-7h4v7"/>',
				'cursor'         => '<path d="m5 3 13 8-6 2 3 6-2 1-3-6-5 4Z"/>',
				'eye'            => '<path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"/><circle cx="12" cy="12" r="2.6"/>',
				'percent'        => '<path d="m6 18 12-12"/><circle cx="7.5" cy="7.5" r="2"/><circle cx="16.5" cy="16.5" r="2"/>',
				'crosshair'      => '<circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>',
				'wrench'         => '<path d="M14.7 6.3a4 4 0 0 0-5 5L3.5 17.5a2.1 2.1 0 0 0 3 3l6.2-6.2a4 4 0 0 0 5-5l-2.5 2.5-3-3Z"/>',
				'arrows'         => '<path d="M4 7h14M15 4l3 3-3 3M20 17H6M9 14l-3 3 3 3"/>',
				'file-text'      => '<path d="M6 3h8l4 4v14H6Z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>',
				'message'        => '<path d="M4 5h16v11H9l-5 4Z"/><path d="M8 9h8M8 12h6"/>',
				'globe'          => '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.5 3.5 5.5 3.5 9S14.5 18.5 12 21M12 3c-2.5 2.5-3.5 5.5-3.5 9s1 6.5 3.5 9"/>',
				'diagram'        => '<circle cx="5" cy="6" r="2"/><circle cx="19" cy="6" r="2"/><circle cx="12" cy="18" r="2"/><path d="M7 7.2 10.8 16M17 7.2 13.2 16M7 6h10"/>',
				'cart'           => '<path d="M3 4h2l2.2 10h9.8l2-7H6"/><circle cx="9" cy="19" r="1"/><circle cx="17" cy="19" r="1"/>',
				'truck'          => '<path d="M3 6h11v9H3Z"/><path d="M14 9h4l3 3v3h-7Z"/><circle cx="7" cy="18" r="2"/><circle cx="18" cy="18" r="2"/><path d="M3 18h2M9 18h7"/>',
				'credit-card'    => '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 9h18M7 15h4"/>',
				'package'        => '<path d="m4 7 8-4 8 4-8 4Z"/><path d="M4 7v10l8 4 8-4V7M12 11v10M8 5l8 4"/>',
				'list'           => '<path d="M8 6h13M8 12h13M8 18h13"/><path d="M3 6h.01M3 12h.01M3 18h.01"/>',
				'history'        => '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>',
				'settings'       => '<circle cx="12" cy="12" r="3"/><path d="M19 13.5v-3l-2-.7-.7-1.7.9-1.9-2.1-2.1-1.9.9-1.7-.7L10.5 2h-3l-.7 2-1.7.7-1.9-.9L1.1 5.9 2 7.8l-.7 1.7L0 10.5v3l2 .7.7 1.7-.9 1.9 2.1 2.1 1.9-.9 1.7.7.7 2h3l.7-2 1.7-.7 1.9.9 2.1-2.1-.9-1.9.7-1.7 2-.7Z" transform="translate(1.25 .25) scale(.9)"/>',
				'database'       => '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/>',
				'shield'         => '<path d="M12 3 5 6v5c0 4.6 2.8 8 7 10 4.2-2 7-5.4 7-10V6l-7-3Z"/><path d="m9 12 2 2 4-4"/>',
				'send'           => '<path d="m3 11 18-8-8 18-2-7-8-3Z"/><path d="m11 14 10-11"/>',
				'filter'         => '<path d="M4 5h16M7 12h10M10 19h4"/>',
				'sun'            => '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
				'monitor'        => '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>',
				'moon'           => '<path d="M20 15.5A8.5 8.5 0 0 1 8.5 4 8.5 8.5 0 1 0 20 15.5Z"/>',
				'info-circle'    => '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',
				'x'              => '<path d="M6 6l12 12M18 6 6 18"/>',
				'chevron-right'  => '<path d="m9 18 6-6-6-6"/>',
				'external-link'   => '<path d="M14 4h6v6"/><path d="M10 14 20 4"/><path d="M20 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h6"/>',
				'circle'         => '<circle cx="12" cy="12" r="3"/>',
			);
			$body = $icons[ $name ] ?? $icons['circle'];
			return '<svg class="ct-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' . $body . '</svg>';
		}
	}
}
