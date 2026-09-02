/**
 * Constello Dropship Hub — bandeau AliExpress contextuel.
 * - Même vocabulaire visuel/tokens que le Shell Constello Smart Index RC129/RC123.
 * - Le bandeau participe au flux et ne recouvre jamais AliExpress.
 * - Configuration locale dans AliExpress : aucun détour par editor.html.
 * - Éditer reste verrouillé tant que /cdh/v1/config n'a pas validé URL + clé API.
 */
( function ( root ) {
	'use strict';

	function buildCategoryOptions( categories ) {
		const byId = new Map();
		( categories || [] ).forEach( ( c ) => { if ( c && c.id != null ) byId.set( c.id, c ); } );
		function depth( cat, seen ) {
			if ( ! cat || ! cat.parent || seen.has( cat.parent ) ) return 0;
			const parent = byId.get( cat.parent );
			if ( ! parent ) return 0;
			seen.add( cat.parent );
			return 1 + depth( parent, seen );
		}
		return ( categories || [] )
			.filter( ( c ) => c && c.id != null && c.name )
			.map( ( c ) => ( { id: c.id, label: '　'.repeat( depth( c, new Set() ) ) + c.name } ) );
	}

	function buildOpenEditorMessage( categoryId, categories ) {
		const msg = { type: 'CDH_OPEN_EDITOR' };
		if ( categoryId != null && categoryId !== '' ) {
			msg.categoryId = categoryId;
			const match = ( categories || [] ).find( ( c ) => c && String( c.id ) === String( categoryId ) );
			if ( match ) msg.categoryName = match.name;
		}
		return msg;
	}

	// Conservée pour les tests/intégrations anciennes ; la barre n'utilise plus ce message.
	function buildOpenSettingsMessage() {
		return { type: 'CDH_OPEN_SETTINGS' };
	}

	function supplierProductIdFromPath( pathname ) {
		const match = String( pathname || '' ).match( /(\d{6,})\.html(?:\/)?$/ );
		return match ? match[ 1 ] : null;
	}

	root.CDHBanner = { buildCategoryOptions, buildOpenEditorMessage, buildOpenSettingsMessage, supplierProductIdFromPath };

	if ( typeof document === 'undefined' || ! document.body ) return;
	if ( typeof window !== 'undefined' && window.top !== window ) return;
	if ( typeof chrome === 'undefined' || ! chrome.runtime || ! chrome.runtime.sendMessage ) return;
	if ( document.getElementById( 'cdh-banner-host' ) ) return;

	const host = document.createElement( 'div' );
	host.id = 'cdh-banner-host';
	host.style.cssText = 'all:initial;display:block;position:relative;width:100%;min-width:0;height:auto;z-index:2147483647;';
	const shadow = host.attachShadow( { mode: 'open' } );

	shadow.innerHTML = `
		<style>
			:host{all:initial;display:block;width:100%;min-width:0;height:auto}
			*{box-sizing:border-box}
			.cdh-root{
				--ct-bg:#f0f2f5;--ct-surface:#fff;--ct-surface-alt:#f8f9fc;--ct-surface-raised:#fff;
				--ct-border:#dee2e6;--ct-border-strong:#ced4da;--ct-text:#1e293b;--ct-text-muted:#667085;--ct-text-subtle:#7c8798;
				--ct-accent:#0d9488;--ct-accent-strong:#0f766e;--ct-accent-hover:#115e59;--ct-on-accent:#fff;
				--ct-success:#16a34a;--ct-success-bg:#dcfce7;--ct-warning:#d97706;--ct-warning-bg:#fef3c7;
				--ct-danger:#dc2626;--ct-danger-bg:#fee2e2;--ct-info:#2563eb;--ct-info-bg:#dbeafe;
				--ct-shadow:0 4px 12px rgba(15,23,42,.05);--ct-radius:12px;
				--ct-font:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
				color:var(--ct-text);font-family:var(--ct-font);font-size:13px;
			}
			.cdh-root[data-theme="dark"]{
				--ct-bg:#121212;--ct-surface:#1e1e1e;--ct-surface-alt:#252525;--ct-surface-raised:#252525;
				--ct-border:#333333;--ct-border-strong:#3b3b3b;--ct-text:#f8f9fa;--ct-text-muted:#a0a0a0;--ct-text-subtle:#7f7f7f;
				--ct-accent:#0dcaf0;--ct-accent-strong:#0dcaf0;--ct-accent-hover:#67e8f9;--ct-on-accent:#071318;
				--ct-success:#10b981;--ct-success-bg:rgba(16,185,129,.12);--ct-warning:#fd7e14;--ct-warning-bg:rgba(253,126,20,.12);
				--ct-danger:#ef4444;--ct-danger-bg:rgba(239,68,68,.12);--ct-info:#3b82f6;--ct-info-bg:rgba(59,130,246,.13);
				--ct-shadow:none;--ct-font:Inter,"Segoe UI",Tahoma,Geneva,Verdana,sans-serif;
			}
			@media(prefers-color-scheme:dark){
				.cdh-root[data-theme="system"]{
					--ct-bg:#121212;--ct-surface:#1e1e1e;--ct-surface-alt:#252525;--ct-surface-raised:#252525;
					--ct-border:#333333;--ct-border-strong:#3b3b3b;--ct-text:#f8f9fa;--ct-text-muted:#a0a0a0;--ct-text-subtle:#7f7f7f;
					--ct-accent:#0dcaf0;--ct-accent-strong:#0dcaf0;--ct-accent-hover:#67e8f9;--ct-on-accent:#071318;
					--ct-success:#10b981;--ct-success-bg:rgba(16,185,129,.12);--ct-warning:#fd7e14;--ct-warning-bg:rgba(253,126,20,.12);
					--ct-danger:#ef4444;--ct-danger-bg:rgba(239,68,68,.12);--ct-info:#3b82f6;--ct-info-bg:rgba(59,130,246,.13);
					--ct-shadow:none;--ct-font:Inter,"Segoe UI",Tahoma,Geneva,Verdana,sans-serif;
				}
			}
			.cdh-banner{
				width:100%;min-width:0;min-height:62px;display:grid;
				grid-template-columns:190px minmax(240px,1fr) auto auto;grid-template-areas:"brand context connection actions";
				align-items:center;column-gap:16px;row-gap:7px;padding:9px 18px;
				background:var(--ct-surface);color:var(--ct-text);border-bottom:1px solid var(--ct-border);box-shadow:var(--ct-shadow);
			}
			.cdh-brand{grid-area:brand;display:flex;align-items:center;gap:10px;min-width:0;user-select:none}
			.cdh-brand-mark{width:38px;height:38px;flex:0 0 38px;display:grid;place-items:center;border-radius:11px;background:color-mix(in srgb,var(--ct-accent) 11%,var(--ct-surface));color:var(--ct-accent-strong)}
			.cdh-brand-glyph{width:22px;height:22px;display:block;fill:currentColor}
			.cdh-brand-copy{min-width:0;line-height:1}
			.cdh-brand-main{display:block;font-size:15px;line-height:16px;font-weight:750;letter-spacing:-.01em;color:var(--ct-text)}
			.cdh-brand-sub{display:block;margin-top:3px;font-size:11.5px;line-height:13px;font-weight:600;color:var(--ct-text-muted)}
			.cdh-context{grid-area:context;min-width:0;display:flex;align-items:center;gap:12px}
			.cdh-select-wrap{width:min(610px,100%);max-width:610px;min-width:0}
			select,.cdh-input{
				width:100%;min-width:0;height:40px;padding:0 34px 0 12px;border:1px solid var(--ct-border-strong);border-radius:9px;
				background:var(--ct-surface-alt);color:var(--ct-text);font:600 13px/1 var(--ct-font);outline:none;
			}
			.cdh-input{padding:0 12px}
			select:focus,.cdh-input:focus{border-color:var(--ct-accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--ct-accent) 14%,transparent)}
			select:disabled{opacity:.6;cursor:not-allowed}
			.cdh-empty-context{min-width:0;color:var(--ct-text-muted);font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
			.cdh-product{min-width:0;width:100%;display:flex;flex-direction:column;gap:3px}
			.cdh-product-top{display:flex;align-items:center;gap:8px;min-width:0}
			.cdh-product-title{min-width:0;max-width:520px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:700;color:var(--ct-text)}
			.cdh-product-meta{min-width:0;font-size:11px;color:var(--ct-text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
			.cdh-chip{display:inline-flex;align-items:center;min-height:22px;padding:3px 8px;border-radius:999px;white-space:nowrap;font-size:11px;font-weight:750;border:0}
			.cdh-chip--ok{background:var(--ct-success-bg);color:var(--ct-success)}
			.cdh-chip--warn{background:var(--ct-warning-bg);color:var(--ct-warning)}
			.cdh-chip--neutral{background:var(--ct-surface-alt);color:var(--ct-text-muted)}
			.cdh-connection{grid-area:connection;justify-self:end;min-width:0;max-width:270px;display:flex;align-items:center;gap:7px;color:var(--ct-text-muted);font-size:12px;white-space:nowrap}
			.cdh-dot{width:7px;height:7px;border-radius:50%;background:var(--ct-success);flex:none}
			.cdh-connection--warn .cdh-dot{background:var(--ct-warning)}.cdh-connection--error .cdh-dot{background:var(--ct-danger)}
			.cdh-connection-text{min-width:0;overflow:hidden;text-overflow:ellipsis}
			.cdh-actions{grid-area:actions;justify-self:end;display:flex;align-items:center;gap:8px;flex:none}
			button{height:40px;border-radius:9px;font-family:inherit;cursor:pointer;transition:background .15s,border-color .15s,color .15s,opacity .15s}
			button:focus-visible{outline:2px solid color-mix(in srgb,var(--ct-accent) 60%,transparent);outline-offset:2px}
			button:disabled{opacity:.42;cursor:not-allowed}
			.cdh-primary-btn{min-width:92px;max-width:195px;padding:0 16px;border:1px solid var(--ct-accent-strong);background:var(--ct-accent-strong);color:var(--ct-on-accent);font-size:13px;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
			.cdh-primary-btn:not(:disabled):hover{background:var(--ct-accent-hover);border-color:var(--ct-accent-hover)}
			.cdh-settings-btn{position:relative;width:40px;padding:0;display:grid;place-items:center;border:1px solid var(--ct-border);background:var(--ct-surface-alt);color:var(--ct-text-muted);flex:none}
			.cdh-settings-btn:hover{background:color-mix(in srgb,var(--ct-accent) 9%,var(--ct-surface));color:var(--ct-accent-strong);border-color:color-mix(in srgb,var(--ct-accent) 26%,var(--ct-border))}
			.cdh-settings-btn svg{width:20px;height:20px;display:block}.cdh-settings-badge{position:absolute;top:-3px;right:-3px;width:10px;height:10px;border-radius:50%;background:var(--ct-warning);border:2px solid var(--ct-surface)}
			.cdh-sr{position:absolute!important;width:1px!important;height:1px!important;overflow:hidden!important;clip:rect(0,0,0,0)!important;white-space:nowrap!important}
			[hidden]{display:none!important}

			/* Configuration native dans le Shadow DOM. Aucune ressource chrome-extension:// n'est chargée :
			 * cela évite les ERR_FILE_NOT_FOUND après mise à jour/rechargement de l'extension. */
			.cdh-modal-backdrop{position:fixed;inset:0;z-index:2147483647;display:grid;place-items:start center;padding:72px 16px 24px;background:rgba(0,0,0,.52)}
			.cdh-modal-shell{width:min(620px,100%);border:1px solid var(--ct-border);border-radius:16px;overflow:hidden;background:var(--ct-surface-raised);box-shadow:0 22px 70px rgba(0,0,0,.28)}
			.cdh-modal-head{display:flex;align-items:center;gap:12px;padding:20px 22px 16px;border-bottom:1px solid var(--ct-border)}
			.cdh-modal-head .cdh-brand-mark{width:46px;height:46px;flex-basis:46px}.cdh-modal-head .cdh-brand-glyph{width:26px;height:26px}
			.cdh-modal-title{min-width:0;flex:1}.cdh-modal-title strong{display:block;font-size:20px;line-height:1.15;color:var(--ct-text)}.cdh-modal-title span{display:block;margin-top:4px;color:var(--ct-text-muted);font-size:13px}
			.cdh-modal-theme{display:flex;gap:5px;padding:4px;border-radius:10px;background:var(--ct-surface-alt);border:1px solid var(--ct-border)}
			.cdh-theme-btn{width:38px;height:36px;padding:0;display:grid;place-items:center;border:0;background:transparent;color:var(--ct-text-muted)}.cdh-theme-btn.active{background:var(--ct-surface);color:var(--ct-accent-strong);box-shadow:inset 0 0 0 1px var(--ct-border)}.cdh-theme-btn svg{width:18px;height:18px}
			.cdh-modal-body{padding:20px 22px}.cdh-field{margin-bottom:18px}.cdh-field label{display:block;margin-bottom:7px;color:var(--ct-text);font-size:12px;font-weight:800;letter-spacing:.04em;text-transform:uppercase}.cdh-field small{display:block;margin-top:6px;color:var(--ct-text-muted);font-size:11px;line-height:1.45}.cdh-field .cdh-input{height:48px;font-size:14px;font-weight:600}
			.cdh-modal-notice{display:none;align-items:flex-start;gap:9px;padding:11px 12px;border-radius:10px;margin-top:4px;font-size:12px;line-height:1.45}.cdh-modal-notice.show{display:flex}.cdh-modal-notice.error{background:var(--ct-danger-bg);color:var(--ct-danger)}.cdh-modal-notice.info{background:var(--ct-info-bg);color:var(--ct-info)}.cdh-modal-notice.ok{background:var(--ct-success-bg);color:var(--ct-success)}
			.cdh-modal-actions{display:flex;justify-content:flex-end;gap:9px;padding:15px 22px 20px;border-top:1px solid var(--ct-border)}.cdh-modal-actions button{min-width:100px;padding:0 16px;font-weight:800}.cdh-cancel-btn{border:1px solid var(--ct-border);background:var(--ct-surface-alt);color:var(--ct-text)}.cdh-save-btn{border:1px solid var(--ct-accent-strong);background:var(--ct-accent-strong);color:var(--ct-on-accent)}

			@media(max-width:1100px){.cdh-banner{grid-template-columns:170px minmax(0,1fr) auto;grid-template-areas:"brand context actions" "brand connection actions";padding:8px 12px;column-gap:12px;row-gap:5px;min-height:72px}.cdh-select-wrap{width:100%;max-width:none}.cdh-connection{justify-self:start;max-width:100%;font-size:11px}.cdh-product-title{max-width:360px}}
			@media(max-width:720px){.cdh-banner{grid-template-columns:minmax(0,1fr) auto;grid-template-areas:"brand actions" "context context" "connection connection";padding:8px 10px;column-gap:10px;row-gap:8px;min-height:0}.cdh-brand-mark{width:34px;height:34px;flex-basis:34px}.cdh-brand-glyph{width:20px;height:20px}.cdh-context,.cdh-select-wrap{width:100%;max-width:none}.cdh-product-top{flex-wrap:wrap;row-gap:5px}.cdh-product-title{flex:1 1 180px;max-width:none}.cdh-product-meta{white-space:normal;line-height:1.35}.cdh-connection{justify-self:start;width:100%;max-width:none}.cdh-actions{gap:6px}.cdh-primary-btn{min-width:78px;max-width:168px;padding:0 12px}.cdh-empty-context{white-space:normal}}
			@media(max-width:430px){.cdh-banner{padding:8px;column-gap:8px}.cdh-brand{gap:7px}.cdh-brand-main{font-size:14px}.cdh-brand-sub{font-size:10.5px}.cdh-primary-btn{min-width:70px;max-width:142px;padding:0 10px;font-size:12px}.cdh-settings-btn{width:40px}select{font-size:12px;padding-left:10px}.cdh-connection{font-size:10.5px}.cdh-chip{font-size:10px;padding:3px 7px}.cdh-modal-backdrop{padding:18px 8px}.cdh-modal-body{padding:15px}.cdh-modal-actions{padding:12px 15px}}
		</style>
		<div class="cdh-root" id="cdh-root" data-theme="system">
			<div class="cdh-banner" role="region" aria-label="Constello Dropship Hub">
				<div class="cdh-brand" aria-label="Constello Dropship Hub">
					<span class="cdh-brand-mark" aria-hidden="true"><svg class="cdh-brand-glyph" viewBox="0 0 100 100"><path d="M42.6,63.5l-8-13.8l8-13.8h15.9l8,13.8l-8,13.8H42.6z M30.5,79.4l8-13.8l-8-13.8H14.6l-8,13.8l8,13.8H30.5z M86.4,79.4l8-13.8l-8-13.8H70.5l-8,13.8l8,13.8H86.4z M58.5,95l8-13.8l-8-13.8H42.6l-8,13.8l8,13.8H58.5z M58.5,32.6l8-13.8L58.5,5H42.6l-8,13.8l8,13.8H58.5z M86.4,48.4l8-13.8l-8-13.8H70.5l-8,13.8l8,13.8H86.4z M29.5,48.4l8-13.8l-8-13.8H13.6l-8,13.8l8,13.8H29.5z"/></svg></span>
					<span class="cdh-brand-copy"><span class="cdh-brand-main">Constello</span><span class="cdh-brand-sub">Dropship Hub</span></span>
				</div>
				<div class="cdh-context">
					<div class="cdh-select-wrap" id="cdh-select-wrap"><select id="cdh-category-select" disabled aria-label="Catégorie WooCommerce"><option value="">Initialisation…</option></select></div>
					<div class="cdh-empty-context" id="cdh-empty-context" hidden>Connecte ta boutique WooCommerce depuis Configuration pour préparer cet article.</div>
					<div class="cdh-product" id="cdh-product" hidden><div class="cdh-product-top"><span class="cdh-chip cdh-chip--neutral" id="cdh-state-chip"></span><span class="cdh-product-title" id="cdh-product-title"></span><span class="cdh-chip cdh-chip--neutral" id="cdh-status-chip" hidden></span></div><div class="cdh-product-meta" id="cdh-product-meta"></div></div>
				</div>
				<div class="cdh-connection cdh-connection--warn" id="cdh-connection"><span class="cdh-dot" aria-hidden="true"></span><span class="cdh-connection-text" id="cdh-connection-text">Connexion…</span></div>
				<div class="cdh-actions"><button type="button" class="cdh-primary-btn" id="cdh-primary-btn" disabled>Éditer</button><button type="button" class="cdh-settings-btn" id="cdh-settings-btn" title="Configuration" aria-label="Configuration"><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V21h-4v-.08A1.7 1.7 0 0 0 8.97 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15.03 1.7 1.7 0 0 0 3.08 14H3v-4h.08A1.7 1.7 0 0 0 4.6 8.97a1.7 1.7 0 0 0-.34-1.88l-.06-.06L7.03 4.2l.06.06A1.7 1.7 0 0 0 8.97 4.6 1.7 1.7 0 0 0 10 3.08V3h4v.08a1.7 1.7 0 0 0 1.03 1.52 1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06a1.7 1.7 0 0 0-.34 1.88A1.7 1.7 0 0 0 20.92 10H21v4h-.08A1.7 1.7 0 0 0 19.4 15Z"></path></svg><span class="cdh-settings-badge" id="cdh-settings-badge" hidden></span></button></div>
				<span class="cdh-sr" id="cdh-live" aria-live="polite"></span>
			</div>
			<div class="cdh-modal-backdrop" id="cdh-modal-backdrop" hidden aria-hidden="true">
				<form class="cdh-modal-shell" id="cdh-settings-form" role="dialog" aria-modal="true" aria-labelledby="cdh-settings-title">
					<div class="cdh-modal-head">
						<span class="cdh-brand-mark" aria-hidden="true"><svg class="cdh-brand-glyph" viewBox="0 0 100 100"><path d="M42.6,63.5l-8-13.8l8-13.8h15.9l8,13.8l-8,13.8H42.6z M30.5,79.4l8-13.8l-8-13.8H14.6l-8,13.8l8,13.8H30.5z M86.4,79.4l8-13.8l-8-13.8H70.5l-8,13.8l8,13.8H86.4z M58.5,95l8-13.8l-8-13.8H42.6l-8,13.8l8,13.8H58.5z M58.5,32.6l8-13.8L58.5,5H42.6l-8,13.8l8,13.8H58.5z M86.4,48.4l8-13.8l-8-13.8H70.5l-8,13.8l8,13.8H86.4z M29.5,48.4l8-13.8l-8-13.8H13.6l-8,13.8l8,13.8H29.5z"/></svg></span>
						<div class="cdh-modal-title"><strong id="cdh-settings-title">Configuration</strong><span>Constello Dropship Hub</span></div>
						<div class="cdh-modal-theme" aria-label="Thème Constello">
							<button type="button" class="cdh-theme-btn" data-modal-theme="system" title="Système" aria-label="Thème système"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="13" rx="2"></rect><path d="M8 21h8M12 17v4"></path></svg></button>
							<button type="button" class="cdh-theme-btn" data-modal-theme="light" title="Clair" aria-label="Thème clair"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"></path></svg></button>
							<button type="button" class="cdh-theme-btn" data-modal-theme="dark" title="Sombre" aria-label="Thème sombre"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z"></path></svg></button>
						</div>
					</div>
					<div class="cdh-modal-body">
						<div class="cdh-field"><label for="cdh-settings-site">Boutique WooCommerce</label><input id="cdh-settings-site" class="cdh-input" type="url" inputmode="url" autocomplete="url" placeholder="https://boutique.example"><small>Adresse HTTPS de la boutique où Constello créera les produits importés.</small></div>
						<div class="cdh-field"><label for="cdh-settings-key">Clé de connexion Constello</label><input id="cdh-settings-key" class="cdh-input" type="password" autocomplete="off" placeholder="Clé enregistrée — laisser vide pour la conserver"><small>Dans WordPress : Constello App → Dropship Hub → Réglages. Copie la clé dédiée à l’extension AliExpress.</small></div>
						<div class="cdh-modal-notice" id="cdh-settings-notice" role="status" aria-live="polite"><span aria-hidden="true">●</span><span id="cdh-settings-notice-text"></span></div>
					</div>
					<div class="cdh-modal-actions"><button type="button" class="cdh-cancel-btn" id="cdh-settings-cancel">Annuler</button><button type="submit" class="cdh-save-btn" id="cdh-settings-save">Connecter</button></div>
				</form>
			</div>
		</div>`;

	document.body.prepend( host );

	const els = {
		root: shadow.getElementById( 'cdh-root' ), selectWrap: shadow.getElementById( 'cdh-select-wrap' ), select: shadow.getElementById( 'cdh-category-select' ), emptyContext: shadow.getElementById( 'cdh-empty-context' ),
		product: shadow.getElementById( 'cdh-product' ), stateChip: shadow.getElementById( 'cdh-state-chip' ), productTitle: shadow.getElementById( 'cdh-product-title' ), statusChip: shadow.getElementById( 'cdh-status-chip' ), productMeta: shadow.getElementById( 'cdh-product-meta' ),
		connection: shadow.getElementById( 'cdh-connection' ), connectionText: shadow.getElementById( 'cdh-connection-text' ), primary: shadow.getElementById( 'cdh-primary-btn' ), settings: shadow.getElementById( 'cdh-settings-btn' ), settingsBadge: shadow.getElementById( 'cdh-settings-badge' ), live: shadow.getElementById( 'cdh-live' ),
		modalBackdrop: shadow.getElementById( 'cdh-modal-backdrop' ), settingsForm: shadow.getElementById( 'cdh-settings-form' ), settingsSite: shadow.getElementById( 'cdh-settings-site' ), settingsKey: shadow.getElementById( 'cdh-settings-key' ), settingsNotice: shadow.getElementById( 'cdh-settings-notice' ), settingsNoticeText: shadow.getElementById( 'cdh-settings-notice-text' ), settingsCancel: shadow.getElementById( 'cdh-settings-cancel' ), settingsSave: shadow.getElementById( 'cdh-settings-save' ), modalThemeButtons: Array.from( shadow.querySelectorAll( '[data-modal-theme]' ) ),
	};

	let loadedCategories = [];
	let mode = 'loading';
	let actionUrl = '';
	let config = null;
	let currentTheme = 'system';
	let previousDocumentOverflow = null;
	let settingsOriginalTheme = 'system';

	function escapeHtml( text ) { const div = document.createElement( 'div' ); div.textContent = String( text ); return div.innerHTML; }
	function setTheme( theme ) { currentTheme = [ 'system', 'light', 'dark' ].includes( theme ) ? theme : 'system'; els.root.dataset.theme = currentTheme; }
	function setConnection( text, kind ) { els.connectionText.textContent = text || ''; els.connection.className = 'cdh-connection' + ( kind ? ' cdh-connection--' + kind : '' ); }
	function setSettingsRequired( required ) { els.settingsBadge.hidden = ! required; }
	function setContextMode( kind ) { els.selectWrap.hidden = kind !== 'select'; els.emptyContext.hidden = kind !== 'empty'; els.product.hidden = kind !== 'product'; }
	function announce( text ) { els.live.textContent = text || ''; }
	function formatImportDate( value ) { if ( ! value ) return ''; const date = new Date( value ); if ( isNaN( date.getTime() ) ) return ''; try { return new Intl.DateTimeFormat( 'fr-CH', { day:'2-digit', month:'short', year:'numeric' } ).format( date ); } catch ( e ) { return date.toLocaleDateString(); } }
	function configuredSiteLabel( cfg ) { let hostName = cfg && cfg.site_name ? String( cfg.site_name ) : ''; try { if ( cfg && cfg.site_url ) hostName = new URL( cfg.site_url ).hostname.replace( /^www\./, '' ); } catch ( e ) {} return [ hostName, cfg && cfg.currency ? String( cfg.currency ) : '' ].filter( Boolean ).join( ' · ' ); }

	function renderDisconnected() {
		mode = 'disconnected'; actionUrl = ''; setContextMode( 'empty' );
		els.emptyContext.textContent = 'Connecte ta boutique WooCommerce depuis Configuration pour charger les catégories.';
		els.primary.textContent = 'Éditer'; els.primary.disabled = true;
		setConnection( 'Connexion requise', 'warn' ); setSettingsRequired( true ); announce( 'Connexion à la boutique requise.' );
	}
	function renderUnavailable( message ) {
		mode = 'unavailable'; actionUrl = ''; setContextMode( 'product' );
		els.stateChip.className = 'cdh-chip cdh-chip--warn'; els.stateChip.textContent = 'État indisponible';
		els.productTitle.textContent = 'Impossible de vérifier si cet article est déjà importé'; els.statusChip.hidden = true; els.productMeta.textContent = message || 'Réessaie dans quelques instants.';
		els.primary.textContent = 'Éditer'; els.primary.disabled = true; setConnection( configuredSiteLabel( config ) || 'WordPress connecté', 'error' ); setSettingsRequired( false ); announce( 'État du produit indisponible. Import temporairement bloqué.' );
	}
	function renderImported( product ) {
		mode = 'imported'; actionUrl = product && product.edit_url ? product.edit_url : ''; setContextMode( 'product' );
		els.stateChip.className = 'cdh-chip cdh-chip--ok'; els.stateChip.textContent = '✓ Déjà importé'; els.productTitle.textContent = ( product && product.name ) || 'Produit WooCommerce';
		els.statusChip.hidden = false; els.statusChip.className = 'cdh-chip ' + ( product && product.status === 'trash' ? 'cdh-chip--warn' : 'cdh-chip--neutral' ); els.statusChip.textContent = ( product && product.status_label ) || 'WooCommerce';
		const parts = []; const date = formatImportDate( product && product.imported_at ); if ( date ) parts.push( 'Importé le ' + date ); if ( product && product.category && product.category.name ) parts.push( product.category.name ); els.productMeta.textContent = parts.join( ' · ' ) || 'Produit lié à cette fiche AliExpress';
		els.primary.textContent = 'Ouvrir WooCommerce'; els.primary.disabled = ! actionUrl; setConnection( configuredSiteLabel( config ) || 'WordPress connecté', '' ); setSettingsRequired( false ); announce( 'Ce produit a déjà été importé dans WooCommerce.' );
	}
	function renderDuplicate( lookup ) {
		mode = 'duplicate'; actionUrl = lookup && lookup.products_url ? lookup.products_url : ''; setContextMode( 'product' );
		els.stateChip.className = 'cdh-chip cdh-chip--warn'; els.stateChip.textContent = '⚠ Doublon détecté'; els.productTitle.textContent = `${ ( lookup && lookup.count ) || 2 } produits WooCommerce liés à cet article`; els.statusChip.hidden = true; els.productMeta.textContent = 'Aucun nouvel import n’est autorisé tant que ce doublon n’est pas examiné.';
		els.primary.textContent = 'Examiner'; els.primary.disabled = ! actionUrl; setConnection( configuredSiteLabel( config ) || 'WordPress connecté', 'warn' ); setSettingsRequired( false ); announce( 'Plusieurs produits WooCommerce sont liés à cette fiche.' );
	}
	async function renderImportMode() {
		mode = 'import'; actionUrl = ''; setContextMode( 'select' ); els.select.disabled = true; els.select.innerHTML = '<option value="">Chargement des catégories…</option>'; els.primary.textContent = 'Éditer'; els.primary.disabled = false; setConnection( configuredSiteLabel( config ) || 'WordPress connecté', '' ); setSettingsRequired( false );
		let response; try { response = await chrome.runtime.sendMessage( { type:'CDH_GET_CATEGORIES' } ); } catch ( err ) { response = { ok:false, message:err && err.message ? err.message : String( err ) }; }
		if ( ! response || response.ok !== true ) { loadedCategories = []; els.select.innerHTML = '<option value="">— Catégories indisponibles —</option>'; els.select.disabled = true; announce( 'Produit non importé. Catégories WooCommerce indisponibles.' ); return; }
		loadedCategories = response.categories || []; const options = buildCategoryOptions( loadedCategories ); els.select.innerHTML = '<option value="">— Choisir une catégorie WooCommerce —</option>' + options.map( ( o ) => `<option value="${ escapeHtml( String( o.id ) ) }">${ escapeHtml( o.label ) }</option>` ).join( '' ); els.select.disabled = false; announce( 'Produit non importé. Prêt à être préparé.' );
	}

	async function loadContext() {
		let uiState; try { uiState = await chrome.runtime.sendMessage( { type:'CDH_GET_UI_STATE' } ); } catch ( e ) { uiState = null; }
		if ( uiState && uiState.ok ) setTheme( uiState.theme || 'system' );
		let cfgResponse; try { cfgResponse = await chrome.runtime.sendMessage( { type:'CDH_GET_CONFIG' } ); } catch ( err ) { cfgResponse = { ok:false, code:'unexpected_error' }; }
		if ( ! cfgResponse || cfgResponse.ok !== true ) { config = null; renderDisconnected(); return; }
		config = cfgResponse.config || {}; setConnection( configuredSiteLabel( config ) || 'WordPress connecté', '' ); setSettingsRequired( false );
		const supplierProductId = supplierProductIdFromPath( location.pathname ); if ( ! supplierProductId ) { renderUnavailable( 'Identifiant AliExpress introuvable dans l’URL.' ); return; }
		let lookupResponse; try { lookupResponse = await chrome.runtime.sendMessage( { type:'CDH_LOOKUP_PRODUCT', payload:{ supplier_key:'aliexpress', supplier_product_id:supplierProductId } } ); } catch ( err ) { lookupResponse = { ok:false, code:'unexpected_error', message:err && err.message ? err.message : String( err ) }; }
		if ( ! lookupResponse || lookupResponse.ok !== true || ! lookupResponse.lookup ) { renderUnavailable( lookupResponse && lookupResponse.code === 'http_404' ? 'Mets à jour Constello Dropship Hub sur WordPress.' : 'La vérification WordPress a échoué.' ); return; }
		const lookup = lookupResponse.lookup; if ( lookup.duplicate ) return renderDuplicate( lookup ); if ( lookup.found && lookup.product ) return renderImported( lookup.product ); if ( lookup.found === false ) return renderImportMode(); renderUnavailable( 'Réponse de lookup inattendue.' );
	}

	function normalizeSiteUrl( raw ) {
		if ( ! raw ) return '';
		let url = String( raw ).trim();
		if ( ! /^https?:\/\//i.test( url ) ) url = 'https://' + url;
		return url.replace( /\/+$/, '' );
	}

	function setModalTheme( theme ) {
		setTheme( theme );
		els.modalThemeButtons.forEach( ( button ) => button.classList.toggle( 'active', button.dataset.modalTheme === currentTheme ) );
	}

	function setSettingsNotice( message, kind ) {
		els.settingsNoticeText.textContent = message || '';
		els.settingsNotice.className = 'cdh-modal-notice' + ( message ? ' show' : '' ) + ( kind ? ' ' + kind : '' );
	}

	function setSettingsBusy( busy ) {
		els.settingsSite.disabled = busy; els.settingsKey.disabled = busy; els.settingsCancel.disabled = busy; els.settingsSave.disabled = busy;
		els.modalThemeButtons.forEach( ( button ) => { button.disabled = busy; } );
		els.settingsSave.textContent = busy ? 'Connexion…' : 'Connecter';
	}

	async function openSettings() {
		settingsOriginalTheme = currentTheme;
		let uiState = null;
		try { uiState = await chrome.runtime.sendMessage( { type:'CDH_GET_UI_STATE' } ); } catch ( err ) {}
		if ( uiState && uiState.ok ) {
			els.settingsSite.value = uiState.site_url || '';
			els.settingsKey.value = '';
			els.settingsKey.placeholder = uiState.has_api_key ? 'Clé enregistrée — laisser vide pour la conserver' : 'Clé de connexion Constello';
			setModalTheme( uiState.theme || currentTheme );
		} else {
			els.settingsSite.value = ''; els.settingsKey.value = ''; setModalTheme( currentTheme );
		}
		setSettingsNotice( '', '' ); setSettingsBusy( false );
		els.modalBackdrop.hidden = false; els.modalBackdrop.setAttribute( 'aria-hidden', 'false' );
		if ( previousDocumentOverflow === null ) previousDocumentOverflow = document.documentElement.style.overflow || '';
		document.documentElement.style.overflow = 'hidden';
		setTimeout( () => els.settingsSite.focus(), 0 );
	}

	function closeSettingsAfterExplicitAction() {
		els.modalBackdrop.hidden = true; els.modalBackdrop.setAttribute( 'aria-hidden', 'true' );
		document.documentElement.style.overflow = previousDocumentOverflow === null ? '' : previousDocumentOverflow; previousDocumentOverflow = null;
	}

	function friendlySettingsError( result ) {
		const code = result && result.code ? result.code : '';
		if ( code === 'missing_site_url' || code === 'invalid_site_url' || code === 'https_required' ) return 'Vérifie l’adresse de la boutique WooCommerce.';
		if ( code === 'missing_api_key' ) return 'Renseigne la clé de connexion Constello.';
		if ( code === 'network_error' ) return 'Impossible de joindre la boutique. Vérifie l’adresse et réessaie.';
		if ( /^http_40[13]$/.test( code ) || code === 'rest_forbidden' || code === 'invalid_api_key' ) return 'Connexion refusée. Vérifie la clé Constello dans WordPress.';
		return ( result && result.message ) || 'Connexion impossible. Vérifie les informations puis réessaie.';
	}

	els.settingsForm.addEventListener( 'submit', async ( event ) => {
		event.preventDefault();
		const siteUrl = normalizeSiteUrl( els.settingsSite.value );
		let parsed; try { parsed = new URL( siteUrl ); } catch ( err ) { setSettingsNotice( 'Vérifie l’adresse de la boutique WooCommerce.', 'error' ); return; }
		if ( parsed.protocol !== 'https:' ) { setSettingsNotice( 'La boutique doit utiliser une adresse HTTPS.', 'error' ); return; }
		setSettingsBusy( true ); setSettingsNotice( 'Connexion à la boutique WooCommerce…', 'info' );
		let result; try { result = await chrome.runtime.sendMessage( { type:'CDH_SAVE_SETTINGS', payload:{ site_url:siteUrl, api_key:els.settingsKey.value, theme:currentTheme } } ); } catch ( err ) { result = { ok:false, code:'unexpected_error', message:err && err.message ? err.message : String( err ) }; }
		if ( ! result || result.ok !== true ) { setSettingsBusy( false ); setSettingsNotice( friendlySettingsError( result ), 'error' ); return; }
		setSettingsNotice( 'Connexion enregistrée.', 'ok' );
		await loadContext(); closeSettingsAfterExplicitAction();
	} );

	els.settingsCancel.addEventListener( 'click', () => { if ( els.settingsSave.disabled ) return; setTheme( settingsOriginalTheme ); closeSettingsAfterExplicitAction(); } );
	els.modalThemeButtons.forEach( ( button ) => button.addEventListener( 'click', () => { if ( button.disabled ) return; setModalTheme( button.dataset.modalTheme ); } ) );
	// La fenêtre ne se ferme ni par clic extérieur ni par Échap : uniquement Annuler ou sauvegarde réussie.
	els.modalBackdrop.addEventListener( 'click', ( event ) => { if ( event.target === els.modalBackdrop ) event.preventDefault(); } );
	window.addEventListener( 'keydown', ( event ) => { if ( ! els.modalBackdrop.hidden && event.key === 'Escape' ) { event.preventDefault(); event.stopPropagation(); } }, true );

	function sendRuntimeMessageCompat( message, timeoutMs ) {
		return new Promise( ( resolve ) => {
			let settled = false;
			const finish = ( value ) => {
				if ( settled ) return;
				settled = true;
				clearTimeout( timer );
				resolve( value );
			};
			const timer = setTimeout( () => finish( { ok:false, code:'message_timeout' } ), Math.max( 250, Number( timeoutMs ) || 2500 ) );
			try {
				// Callback API : compatible même si runtime.sendMessage ne renvoie pas de Promise.
				chrome.runtime.sendMessage( message, ( response ) => {
					if ( chrome.runtime.lastError ) {
						finish( { ok:false, code:'runtime_error', message:chrome.runtime.lastError.message || '' } );
						return;
					}
					finish( response || { ok:false, code:'no_response' } );
				} );
			} catch ( err ) {
				finish( { ok:false, code:'runtime_error', message:err && err.message ? err.message : String( err ) } );
			}
		} );
	}

	els.primary.addEventListener( 'click', async () => {
		if ( els.primary.disabled ) return;
		if ( mode === 'import' ) {
			const previousText = els.primary.textContent;
			els.primary.disabled = true;
			els.primary.textContent = 'Préparation…';
			try {
				// Le service worker accuse réception immédiatement puis prépare/ouvre l'éditeur en
				// arrière-plan. Le bouton n'attend donc plus le scroll lazy AliExpress.
				const result = await sendRuntimeMessageCompat( buildOpenEditorMessage( els.select.value, loadedCategories ), 2500 );
				if ( ! result || result.ok !== true ) throw new Error( 'Ouverture impossible' );
			} catch ( err ) {
				renderUnavailable( 'Impossible de lancer l’éditeur. Recharge cette fiche AliExpress puis réessaie.' );
			} finally {
				els.primary.textContent = previousText;
				els.primary.disabled = false;
			}
			return;
		}
		try {
			if ( ( mode === 'imported' || mode === 'duplicate' ) && actionUrl ) { const result = await chrome.runtime.sendMessage( { type:'CDH_OPEN_SITE_URL', url:actionUrl } ); if ( ! result || result.ok !== true ) renderUnavailable( 'Impossible d’ouvrir WordPress.' ); }
		} catch ( err ) {
			renderUnavailable( 'Impossible d’ouvrir WordPress.' );
		}
	} );
	els.settings.addEventListener( 'click', openSettings );


	loadContext();
} )( typeof window !== 'undefined' ? window : globalThis );
