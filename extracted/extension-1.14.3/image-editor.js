/**
 * Constello Dropship Hub — Image Studio (IMG-01..IMG-05)
 *
 * Local-only image preparation module for editor.html.
 * - brush / eraser / eyedropper
 * - crop, resize, rotate
 * - undo / redo / reset
 * - duplicate current image
 * - keeps the original remote image untouched
 *
 * IMPORTANT: edited images are stored locally as data:image/png URLs in the editor state.
 * Edited images are stored locally as data:image/png URLs until import. The editor uploads them
 * to WordPress through /cdh/v1/import-media before creating the WooCommerce product.
 */
( function () {
	'use strict';

	if ( typeof document === 'undefined' ) return;

	const MAX_HISTORY = 10;
	const MAX_CANVAS_EDGE = 4096;
	const LOCAL_IMAGE_RE = /^data:image\//i;

	function $( id ) { return document.getElementById( id ); }
	function clamp( value, min, max ) { return Math.min( max, Math.max( min, value ) ); }
	function isLocalImage( url ) { return LOCAL_IMAGE_RE.test( String( url || '' ) ); }

	function installStyles() {
		const style = document.createElement( 'style' );
		style.id = 'cdh-image-studio-styles';
		style.textContent = `
			.gallery-studio-actions { display:flex; flex-wrap:wrap; gap:8px; margin:10px 0; align-items:center; }
			.gallery-studio-actions button { border:1px solid var(--border-strong,#ccd0d4); border-radius:9px; background:var(--surface,#fff); color:var(--text,#1d2327); padding:8px 12px; cursor:pointer; font:inherit; }
			.gallery-studio-actions button:hover { background:var(--surface-2,#f6f7f7); }
			.gallery-studio-actions .studio-primary { background:var(--accent-strong,var(--accent,#0f766e)); border-color:var(--accent-strong,var(--accent,#0f766e)); color:var(--ct-on-accent,var(--on-accent,#fff)); font-weight:600; }
			.gallery-studio-actions .studio-primary:hover { filter:brightness(.96); }
			.studio-local-note { display:none; margin:8px 0 0; padding:8px 10px; border-radius:6px; background:var(--warn-bg,#fff8e1); color:var(--warn,#6d5700); font-size:12px; }
			.studio-local-note.visible { display:block; }
			#cdh-image-studio[hidden] { display:none !important; }
			#cdh-image-studio { position:fixed; inset:0; z-index:2147483646; background:rgba(20,24,28,.72); padding:24px; overflow:auto; font-family:system-ui,-apple-system,sans-serif; color:var(--text,#1e293b); }
			.studio-shell { width:min(1180px,100%); margin:0 auto; background:var(--surface,#fff); border-radius:12px; overflow:hidden; box-shadow:0 16px 50px rgba(0,0,0,.35); }
			.studio-header { display:flex; align-items:center; gap:12px; padding:14px 18px; border-bottom:1px solid var(--border,#ddd); background:var(--surface,#fff); position:sticky; top:0; z-index:3; }
			.studio-title { font-size:16px; font-weight:700; margin-right:auto; }
			.studio-header button, .studio-panel button { min-height:36px; border:1px solid var(--border-strong,#ccd0d4); border-radius:6px; background:var(--surface,#fff); color:var(--text,#1e293b); padding:7px 11px; cursor:pointer; font:inherit; }
			.studio-header button:disabled, .studio-panel button:disabled { opacity:.45; cursor:not-allowed; }
			.studio-header .save { background:var(--accent-strong,var(--accent,#0f766e)); border-color:var(--accent-strong,var(--accent,#0f766e)); color:var(--ct-on-accent,var(--on-accent,#fff)); font-weight:600; }
			.studio-body { display:grid; grid-template-columns:220px minmax(0,1fr) 250px; min-height:600px; }
			.studio-panel { padding:14px; border-right:1px solid var(--border,#e3e3e3); background:var(--surface-2,#fafafa); }
			.studio-panel.right { border-right:0; border-left:1px solid var(--border,#e3e3e3); }
			.studio-panel h3 { font-size:12px; text-transform:uppercase; letter-spacing:.04em; color:var(--muted,#555); margin:0 0 10px; }
			.studio-tools { display:grid; grid-template-columns:1fr 1fr; gap:7px; margin-bottom:16px; }
			.studio-tools button.active { background:var(--accent-2,#e8f0fe); border-color:var(--accent,#0d9488); color:var(--accent-strong,#0f766e); font-weight:600; }
			.studio-field { margin-bottom:12px; }
			.studio-field label { display:block; font-size:12px; color:var(--muted,#555); margin-bottom:5px; }
			.studio-field input[type=number], .studio-field input[type=text], .studio-field select { width:100%; padding:7px 8px; border:1px solid var(--border-strong,#ccd0d4); border-radius:7px; background:var(--surface,#fff); color:var(--text,#1e293b); font:inherit; }
			.studio-field input[type=range] { width:100%; }
			.studio-inline { display:flex; gap:7px; align-items:center; }
			.studio-inline > * { min-width:0; flex:1; }
			.studio-check { display:flex; align-items:center; gap:7px; font-size:12px; margin:7px 0 12px; }
			.studio-canvas-area { min-width:0; background:#0b1120; padding:18px; display:flex; align-items:center; justify-content:center; overflow:auto; }
			.studio-canvas-wrap { position:relative; display:inline-block; line-height:0; background-image:linear-gradient(45deg,#ddd 25%,transparent 25%),linear-gradient(-45deg,#ddd 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#ddd 75%),linear-gradient(-45deg,transparent 75%,#ddd 75%); background-size:20px 20px; background-position:0 0,0 10px,10px -10px,-10px 0; }
			#studio-canvas, #studio-overlay { display:block; max-width:100%; height:auto; }
			#studio-overlay { position:absolute; inset:0; width:100%; height:100%; touch-action:none; cursor:crosshair; }
			.studio-dim { font-size:12px; color:var(--muted,#555); margin:6px 0 14px; }
			.studio-status { min-height:34px; margin-top:10px; padding:8px; border-radius:9px; background:var(--surface-2,#f1f3f4); font-size:12px; color:var(--muted,#444); }
			.studio-status.error { background:var(--danger-bg,#fdecea); color:var(--danger,#b3261e); }
			.studio-status.ok { background:var(--success-bg,#e6f4ea); color:var(--success,#1e7e34); }
			.studio-color-row { display:flex; gap:8px; align-items:center; }
			.studio-color-row input[type=color] { width:42px; height:36px; border:1px solid var(--border-strong,#ccd0d4); padding:2px; border-radius:5px; }
			.studio-kbd { color:var(--muted,#667085); font-size:11px; line-height:1.5; }
			@media (max-width:900px) {
				#cdh-image-studio { padding:8px; }
				.studio-body { grid-template-columns:1fr; }
				.studio-panel, .studio-panel.right { border:0; border-bottom:1px solid #e3e3e3; }
				.studio-canvas-area { min-height:360px; }
			}
		`;
		document.head.appendChild( style );
	}

	function buildStudio() {
		const root = document.createElement( 'div' );
		root.id = 'cdh-image-studio';
		root.hidden = true;
		root.innerHTML = `
			<div class="studio-shell" role="dialog" aria-modal="true" aria-labelledby="studio-title">
				<div class="studio-header">
					<button type="button" id="studio-close">← Retour</button>
					<div class="studio-title" id="studio-title">Studio Image</div>
					<button type="button" id="studio-undo" title="Ctrl+Z">Annuler</button>
					<button type="button" id="studio-redo" title="Ctrl+Shift+Z">Rétablir</button>
					<button type="button" id="studio-reset">Original</button>
					<button type="button" id="studio-save" class="save">✓ Appliquer</button>
				</div>
				<div class="studio-body">
					<aside class="studio-panel">
						<h3>Outils</h3>
						<div class="studio-tools" id="studio-tools">
							<button type="button" data-tool="brush">Pinceau</button>
							<button type="button" data-tool="eraser">Gomme</button>
							<button type="button" data-tool="eyedropper">Pipette</button>
							<button type="button" data-tool="crop">Recadrer</button>
						</div>
						<div class="studio-field">
							<label for="studio-size">Taille de l’outil : <span id="studio-size-label">30</span> px</label>
							<input id="studio-size" type="range" min="1" max="200" value="30">
						</div>
						<div class="studio-field">
							<label>Couleur</label>
							<div class="studio-color-row">
								<input id="studio-color" type="color" value="#ffffff" aria-label="Couleur du pinceau">
								<input id="studio-color-hex" type="text" value="#FFFFFF" maxlength="7" aria-label="Couleur hexadécimale">
							</div>
						</div>
						<button type="button" id="studio-apply-crop" disabled>Appliquer le recadrage</button>
						<p class="studio-kbd">Pinceau/gomme : maintenir le clic et tracer.<br>Pipette : cliquer une couleur.<br>Recadrage : tracer un rectangle puis appliquer.</p>
					</aside>
					<div class="studio-canvas-area">
						<div class="studio-canvas-wrap" id="studio-canvas-wrap">
							<canvas id="studio-canvas"></canvas>
							<canvas id="studio-overlay"></canvas>
						</div>
					</div>
					<aside class="studio-panel right">
						<h3>Dimensions</h3>
						<div class="studio-dim" id="studio-dim">—</div>
						<div class="studio-inline">
							<div class="studio-field"><label for="studio-width">Largeur</label><input id="studio-width" type="number" min="1" max="4096"></div>
							<div class="studio-field"><label for="studio-height">Hauteur</label><input id="studio-height" type="number" min="1" max="4096"></div>
						</div>
						<label class="studio-check"><input id="studio-lock-ratio" type="checkbox" checked> Conserver les proportions</label>
						<button type="button" id="studio-resize">Redimensionner</button>
						<h3 style="margin-top:20px">Rotation</h3>
						<div class="studio-inline">
							<button type="button" id="studio-rotate-left">↶ 90°</button>
							<button type="button" id="studio-rotate-right">↷ 90°</button>
						</div>
						<h3 style="margin-top:20px">Fond rapide</h3>
						<button type="button" id="studio-fill">Remplir la transparence avec la couleur</button>
						<div id="studio-status" class="studio-status" aria-live="polite">Sélectionne un outil.</div>
					</aside>
				</div>
			</div>`;
		document.body.appendChild( root );
		return root;
	}

	const studio = {
		root: null,
		canvas: null,
		overlay: null,
		ctx: null,
		octx: null,
		tool: 'brush',
		drawing: false,
		last: null,
		cropStart: null,
		cropRect: null,
		history: [],
		future: [],
		originalSnapshot: null,
		originalUrl: '',
		ratio: 1,
		loaded: false,
		externalTarget: null,
	};

	function status( text, kind ) {
		const el = $( 'studio-status' );
		if ( ! el ) return;
		el.textContent = text;
		el.className = 'studio-status' + ( kind ? ' ' + kind : '' );
	}

	function updateDimUi() {
		if ( ! studio.canvas ) return;
		$( 'studio-dim' ).textContent = `${ studio.canvas.width } × ${ studio.canvas.height } px`;
		$( 'studio-width' ).value = studio.canvas.width;
		$( 'studio-height' ).value = studio.canvas.height;
		studio.ratio = studio.canvas.width / studio.canvas.height;
	}

	function syncOverlaySize() {
		studio.overlay.width = studio.canvas.width;
		studio.overlay.height = studio.canvas.height;
		studio.overlay.style.width = studio.canvas.style.width || '100%';
		studio.overlay.style.height = studio.canvas.style.height || 'auto';
	}

	function cloneImageData() {
		return studio.ctx.getImageData( 0, 0, studio.canvas.width, studio.canvas.height );
	}

	function pushHistory() {
		if ( ! studio.loaded ) return;
		try {
			studio.history.push( { width: studio.canvas.width, height: studio.canvas.height, data: cloneImageData() } );
			if ( studio.history.length > MAX_HISTORY ) studio.history.shift();
			studio.future = [];
			updateHistoryButtons();
		} catch ( e ) {
			status( 'Historique indisponible pour cette image.', 'error' );
		}
	}

	function restoreSnapshot( snap ) {
		if ( ! snap ) return;
		studio.canvas.width = snap.width;
		studio.canvas.height = snap.height;
		studio.ctx = studio.canvas.getContext( '2d', { willReadFrequently: true } );
		studio.ctx.putImageData( snap.data, 0, 0 );
		syncOverlaySize();
		clearOverlay();
		studio.cropRect = null;
		updateDimUi();
	}

	function updateHistoryButtons() {
		$( 'studio-undo' ).disabled = studio.history.length <= 1;
		$( 'studio-redo' ).disabled = studio.future.length === 0;
	}

	function undo() {
		if ( studio.history.length <= 1 ) return;
		const current = studio.history.pop();
		studio.future.push( current );
		restoreSnapshot( studio.history[ studio.history.length - 1 ] );
		updateHistoryButtons();
		status( 'Modification annulée.' );
	}

	function redo() {
		if ( ! studio.future.length ) return;
		const snap = studio.future.pop();
		studio.history.push( snap );
		restoreSnapshot( snap );
		updateHistoryButtons();
		status( 'Modification rétablie.' );
	}

	function clearOverlay() {
		studio.octx.clearRect( 0, 0, studio.overlay.width, studio.overlay.height );
	}

	function pointerToCanvas( event ) {
		const rect = studio.overlay.getBoundingClientRect();
		return {
			x: clamp( ( event.clientX - rect.left ) * studio.overlay.width / Math.max( 1, rect.width ), 0, studio.overlay.width ),
			y: clamp( ( event.clientY - rect.top ) * studio.overlay.height / Math.max( 1, rect.height ), 0, studio.overlay.height ),
		};
	}

	function drawStroke( from, to ) {
		const size = parseInt( $( 'studio-size' ).value, 10 ) || 30;
		studio.ctx.save();
		studio.ctx.lineCap = 'round';
		studio.ctx.lineJoin = 'round';
		studio.ctx.lineWidth = size;
		if ( studio.tool === 'eraser' ) {
			studio.ctx.globalCompositeOperation = 'destination-out';
			studio.ctx.strokeStyle = 'rgba(0,0,0,1)';
		} else {
			studio.ctx.globalCompositeOperation = 'source-over';
			studio.ctx.strokeStyle = $( 'studio-color' ).value;
		}
		studio.ctx.beginPath();
		studio.ctx.moveTo( from.x, from.y );
		studio.ctx.lineTo( to.x, to.y );
		studio.ctx.stroke();
		studio.ctx.restore();
	}

	function drawCropOverlay() {
		clearOverlay();
		if ( ! studio.cropRect ) return;
		const r = studio.cropRect;
		studio.octx.save();
		studio.octx.fillStyle = 'rgba(0,0,0,.42)';
		studio.octx.fillRect( 0, 0, studio.overlay.width, studio.overlay.height );
		studio.octx.clearRect( r.x, r.y, r.w, r.h );
		studio.octx.strokeStyle = '#fff';
		studio.octx.lineWidth = Math.max( 1, studio.overlay.width / 800 );
		studio.octx.setLineDash( [ 8, 6 ] );
		studio.octx.strokeRect( r.x, r.y, r.w, r.h );
		studio.octx.restore();
	}

	function selectTool( tool ) {
		studio.tool = tool;
		document.querySelectorAll( '#studio-tools [data-tool]' ).forEach( ( btn ) => btn.classList.toggle( 'active', btn.dataset.tool === tool ) );
		studio.overlay.style.cursor = tool === 'eyedropper' ? 'copy' : 'crosshair';
		if ( tool !== 'crop' ) {
			studio.cropRect = null;
			$( 'studio-apply-crop' ).disabled = true;
			clearOverlay();
		}
		status( tool === 'brush' ? 'Pinceau actif.' : tool === 'eraser' ? 'Gomme active.' : tool === 'eyedropper' ? 'Clique une couleur dans l’image.' : 'Trace la zone à conserver.' );
	}

	function onPointerDown( event ) {
		if ( ! studio.loaded ) return;
		event.preventDefault();
		const p = pointerToCanvas( event );
		if ( studio.tool === 'eyedropper' ) {
			try {
				const px = studio.ctx.getImageData( Math.floor( p.x ), Math.floor( p.y ), 1, 1 ).data;
				const hex = '#' + [ px[ 0 ], px[ 1 ], px[ 2 ] ].map( ( n ) => n.toString( 16 ).padStart( 2, '0' ) ).join( '' ).toUpperCase();
				$( 'studio-color' ).value = hex;
				$( 'studio-color-hex' ).value = hex;
				status( `Couleur copiée : ${ hex }`, 'ok' );
			} catch ( e ) {
				status( 'Impossible de lire cette couleur.', 'error' );
			}
			return;
		}
		studio.drawing = true;
		studio.last = p;
		studio.overlay.setPointerCapture?.( event.pointerId );
		if ( studio.tool === 'crop' ) {
			studio.cropStart = p;
			studio.cropRect = { x: p.x, y: p.y, w: 0, h: 0 };
			drawCropOverlay();
		} else {
			drawStroke( p, { x: p.x + .01, y: p.y + .01 } );
		}
	}

	function onPointerMove( event ) {
		if ( ! studio.drawing ) return;
		event.preventDefault();
		const p = pointerToCanvas( event );
		if ( studio.tool === 'crop' ) {
			const x = Math.min( studio.cropStart.x, p.x );
			const y = Math.min( studio.cropStart.y, p.y );
			const w = Math.abs( p.x - studio.cropStart.x );
			const h = Math.abs( p.y - studio.cropStart.y );
			studio.cropRect = { x, y, w, h };
			drawCropOverlay();
		} else if ( studio.tool === 'brush' || studio.tool === 'eraser' ) {
			drawStroke( studio.last, p );
			studio.last = p;
		}
	}

	function onPointerUp( event ) {
		if ( ! studio.drawing ) return;
		studio.drawing = false;
		studio.overlay.releasePointerCapture?.( event.pointerId );
		if ( studio.tool === 'crop' ) {
			const valid = studio.cropRect && studio.cropRect.w >= 2 && studio.cropRect.h >= 2;
			$( 'studio-apply-crop' ).disabled = ! valid;
			status( valid ? 'Zone de recadrage prête.' : 'Zone trop petite.' );
		} else if ( studio.tool === 'brush' || studio.tool === 'eraser' ) {
			pushHistory();
		}
	}

	function applyCrop() {
		const r = studio.cropRect;
		if ( ! r || r.w < 2 || r.h < 2 ) return;
		const sx = Math.floor( r.x );
		const sy = Math.floor( r.y );
		const sw = Math.max( 1, Math.floor( r.w ) );
		const sh = Math.max( 1, Math.floor( r.h ) );
		const tmp = document.createElement( 'canvas' );
		tmp.width = sw;
		tmp.height = sh;
		tmp.getContext( '2d' ).drawImage( studio.canvas, sx, sy, sw, sh, 0, 0, sw, sh );
		studio.canvas.width = sw;
		studio.canvas.height = sh;
		studio.ctx = studio.canvas.getContext( '2d', { willReadFrequently: true } );
		studio.ctx.drawImage( tmp, 0, 0 );
		syncOverlaySize();
		studio.cropRect = null;
		clearOverlay();
		$( 'studio-apply-crop' ).disabled = true;
		updateDimUi();
		pushHistory();
		status( 'Image recadrée.', 'ok' );
	}

	function resizeCanvas( width, height ) {
		width = clamp( Math.round( width ), 1, MAX_CANVAS_EDGE );
		height = clamp( Math.round( height ), 1, MAX_CANVAS_EDGE );
		const tmp = document.createElement( 'canvas' );
		tmp.width = width;
		tmp.height = height;
		const tctx = tmp.getContext( '2d' );
		tctx.imageSmoothingEnabled = true;
		tctx.imageSmoothingQuality = 'high';
		tctx.drawImage( studio.canvas, 0, 0, width, height );
		studio.canvas.width = width;
		studio.canvas.height = height;
		studio.ctx = studio.canvas.getContext( '2d', { willReadFrequently: true } );
		studio.ctx.drawImage( tmp, 0, 0 );
		syncOverlaySize();
		updateDimUi();
		pushHistory();
		status( `Image redimensionnée en ${ width } × ${ height } px.`, 'ok' );
	}

	function rotate( direction ) {
		const oldW = studio.canvas.width;
		const oldH = studio.canvas.height;
		const tmp = document.createElement( 'canvas' );
		tmp.width = oldH;
		tmp.height = oldW;
		const tctx = tmp.getContext( '2d' );
		tctx.translate( tmp.width / 2, tmp.height / 2 );
		tctx.rotate( direction * Math.PI / 2 );
		tctx.drawImage( studio.canvas, -oldW / 2, -oldH / 2 );
		studio.canvas.width = tmp.width;
		studio.canvas.height = tmp.height;
		studio.ctx = studio.canvas.getContext( '2d', { willReadFrequently: true } );
		studio.ctx.drawImage( tmp, 0, 0 );
		syncOverlaySize();
		updateDimUi();
		pushHistory();
		status( 'Rotation appliquée.', 'ok' );
	}

	function fillTransparency() {
		const tmp = document.createElement( 'canvas' );
		tmp.width = studio.canvas.width;
		tmp.height = studio.canvas.height;
		const tctx = tmp.getContext( '2d' );
		tctx.fillStyle = $( 'studio-color' ).value;
		tctx.fillRect( 0, 0, tmp.width, tmp.height );
		tctx.drawImage( studio.canvas, 0, 0 );
		studio.ctx.clearRect( 0, 0, studio.canvas.width, studio.canvas.height );
		studio.ctx.drawImage( tmp, 0, 0 );
		pushHistory();
		status( 'Transparence remplie avec la couleur sélectionnée.', 'ok' );
	}

	async function fetchImageBitmapWithPermission( url ) {
		if ( isLocalImage( url ) ) {
			const response = await fetch( url );
			return createImageBitmap( await response.blob() );
		}
		let parsed;
		try { parsed = new URL( url ); } catch ( e ) { throw new Error( 'URL image invalide.' ); }
		if ( parsed.protocol !== 'https:' ) throw new Error( 'Seules les images HTTPS stables sont modifiables.' );
		const response = await fetch( url, { credentials: 'omit', cache: 'force-cache' } );
		if ( ! response.ok ) throw new Error( `Image inaccessible (HTTP ${ response.status }).` );
		const blob = await response.blob();
		if ( ! /^image\//i.test( blob.type || '' ) ) throw new Error( 'La ressource n’est pas une image.' );
		return createImageBitmap( blob );
	}

	async function loadIntoStudio( url ) {
		studio.loaded = false;
		studio.originalUrl = url;
		studio.history = [];
		studio.future = [];
		studio.cropRect = null;
		clearOverlay();
		status( 'Chargement de l’image…' );
		const bitmap = await fetchImageBitmapWithPermission( url );
		let width = bitmap.width;
		let height = bitmap.height;
		if ( width > MAX_CANVAS_EDGE || height > MAX_CANVAS_EDGE ) {
			const scale = Math.min( MAX_CANVAS_EDGE / width, MAX_CANVAS_EDGE / height );
			width = Math.max( 1, Math.round( width * scale ) );
			height = Math.max( 1, Math.round( height * scale ) );
		}
		studio.canvas.width = width;
		studio.canvas.height = height;
		studio.ctx = studio.canvas.getContext( '2d', { willReadFrequently: true } );
		studio.ctx.imageSmoothingEnabled = true;
		studio.ctx.imageSmoothingQuality = 'high';
		studio.ctx.drawImage( bitmap, 0, 0, width, height );
		bitmap.close?.();
		syncOverlaySize();
		updateDimUi();
		studio.loaded = true;
		pushHistory();
		studio.originalSnapshot = studio.history[ 0 ];
		selectTool( 'brush' );
		status( 'Image prête. Les modifications seront envoyées à WordPress au moment de l’import.', 'ok' );
	}

	async function openStudio( forcedUrl, externalTarget ) {
		const input = $( 'gallery-main-url' );
		const url = String( forcedUrl || ( input && input.value.trim() ) || '' ).trim();
		studio.externalTarget = externalTarget || null;
		if ( ! url ) {
			showLocalNote( 'Ajoute ou sélectionne d’abord une image.' );
			return;
		}
		studio.root.hidden = false;
		document.body.style.overflow = 'hidden';
		try {
			await loadIntoStudio( url );
		} catch ( err ) {
			status( err && err.message ? err.message : String( err ), 'error' );
		}
	}

	function closeStudio() {
		studio.root.hidden = true;
		document.body.style.overflow = '';
		studio.externalTarget = null;
	}

	function applyToGallery() {
		if ( ! studio.loaded ) return;
		let dataUrl;
		try { dataUrl = studio.canvas.toDataURL( 'image/webp', 0.92 ); }
		catch ( e ) { status( 'Export local impossible pour cette image.', 'error' ); return; }
		if ( studio.externalTarget && studio.externalTarget.targetId ) {
			const targetId = studio.externalTarget.targetId;
			document.dispatchEvent( new CustomEvent( 'cdh:external-image-updated', { detail: { targetId, dataUrl } } ) );
			studio.root.hidden = true; document.body.style.overflow = ''; studio.externalTarget = null;
			return;
		}
		const input = $( 'gallery-main-url' );
		input.value = dataUrl;
		input.dispatchEvent( new Event( 'input', { bubbles: true } ) );
		markLocalState();
		closeStudio();
		showLocalNote( 'Image modifiée localement · elle sera envoyée à WordPress au moment de l’import.' );
	}

	function resetOriginal() {
		if ( ! studio.originalSnapshot ) return;
		restoreSnapshot( studio.originalSnapshot );
		studio.history = [ studio.originalSnapshot ];
		studio.future = [];
		updateHistoryButtons();
		status( 'Image originale restaurée.', 'ok' );
	}

	function duplicateCurrentImage() {
		const input = $( 'gallery-main-url' );
		if ( ! input || ! input.value.trim() ) return;
		document.dispatchEvent( new CustomEvent( 'cdh:duplicate-selected-image' ) );
		markLocalState();
		showLocalNote( 'Image dupliquée dans la galerie.' );
	}

	function anyLocalImages() {
		const main = $( 'gallery-main-url' );
		if ( main && isLocalImage( main.value ) ) return true;
		return Array.from( document.querySelectorAll( '#gallery-thumbs img' ) ).some( ( img ) => isLocalImage( img.src ) );
	}

	function markLocalState() {
		const note = $( 'studio-local-note' );
		if ( ! note ) return;
		if ( anyLocalImages() ) note.classList.add( 'visible' );
	}

	function showLocalNote( message ) {
		const note = $( 'studio-local-note' );
		if ( ! note ) return;
		note.textContent = message;
		note.classList.add( 'visible' );
	}

	function injectGalleryControls() {
		const gallery = document.querySelector( '.gallery-main' );
		if ( ! gallery ) return;
		if ( ! $( 'studio-edit-image' ) ) {
			const actions = document.createElement( 'div' );
			actions.className = 'gallery-studio-actions';
			actions.innerHTML = `<button type="button" id="studio-edit-image" class="studio-primary">Modifier l’image</button><button type="button" id="studio-duplicate-image">Dupliquer</button>`;
			gallery.appendChild( actions );
		}
		if ( ! $( 'studio-local-note' ) ) {
			const note = document.createElement( 'div' );
			note.id = 'studio-local-note'; note.className = 'studio-local-note'; note.textContent = 'Image modifiée localement · envoi automatique à l’import.'; gallery.appendChild( note );
		}
	}

	function bindGalleryControls() {
		const edit = $( 'studio-edit-image' );
		const duplicate = $( 'studio-duplicate-image' );
		if ( edit && ! edit.dataset.studioBound ) { edit.dataset.studioBound = '1'; edit.addEventListener( 'click', () => openStudio() ); }
		if ( duplicate && ! duplicate.dataset.studioBound ) { duplicate.dataset.studioBound = '1'; duplicate.addEventListener( 'click', duplicateCurrentImage ); }
	}

	function bindStudioUi() {
		studio.canvas = $( 'studio-canvas' );
		studio.overlay = $( 'studio-overlay' );
		studio.ctx = studio.canvas.getContext( '2d', { willReadFrequently: true } );
		studio.octx = studio.overlay.getContext( '2d' );
		studio.overlay.addEventListener( 'pointerdown', onPointerDown );
		studio.overlay.addEventListener( 'pointermove', onPointerMove );
		studio.overlay.addEventListener( 'pointerup', onPointerUp );
		studio.overlay.addEventListener( 'pointercancel', onPointerUp );
		document.querySelectorAll( '#studio-tools [data-tool]' ).forEach( ( btn ) => btn.addEventListener( 'click', () => selectTool( btn.dataset.tool ) ) );
		$( 'studio-close' ).addEventListener( 'click', closeStudio );
		$( 'studio-save' ).addEventListener( 'click', applyToGallery );
		$( 'studio-undo' ).addEventListener( 'click', undo );
		$( 'studio-redo' ).addEventListener( 'click', redo );
		$( 'studio-reset' ).addEventListener( 'click', resetOriginal );
		$( 'studio-apply-crop' ).addEventListener( 'click', applyCrop );
		$( 'studio-rotate-left' ).addEventListener( 'click', () => rotate( -1 ) );
		$( 'studio-rotate-right' ).addEventListener( 'click', () => rotate( 1 ) );
		$( 'studio-fill' ).addEventListener( 'click', fillTransparency );
		$( 'studio-size' ).addEventListener( 'input', () => { $( 'studio-size-label' ).textContent = $( 'studio-size' ).value; } );
		$( 'studio-color' ).addEventListener( 'input', () => { $( 'studio-color-hex' ).value = $( 'studio-color' ).value.toUpperCase(); } );
		$( 'studio-color-hex' ).addEventListener( 'change', () => {
			const raw = $( 'studio-color-hex' ).value.trim();
			if ( /^#[0-9a-f]{6}$/i.test( raw ) ) {
				$( 'studio-color' ).value = raw;
				$( 'studio-color-hex' ).value = raw.toUpperCase();
			} else {
				$( 'studio-color-hex' ).value = $( 'studio-color' ).value.toUpperCase();
			}
		} );
		$( 'studio-width' ).addEventListener( 'input', () => {
			if ( ! $( 'studio-lock-ratio' ).checked || ! studio.ratio ) return;
			const w = parseInt( $( 'studio-width' ).value, 10 );
			if ( w > 0 ) $( 'studio-height' ).value = Math.max( 1, Math.round( w / studio.ratio ) );
		} );
		$( 'studio-height' ).addEventListener( 'input', () => {
			if ( ! $( 'studio-lock-ratio' ).checked || ! studio.ratio ) return;
			const h = parseInt( $( 'studio-height' ).value, 10 );
			if ( h > 0 ) $( 'studio-width' ).value = Math.max( 1, Math.round( h * studio.ratio ) );
		} );
		$( 'studio-resize' ).addEventListener( 'click', () => {
			const width = parseInt( $( 'studio-width' ).value, 10 );
			const height = parseInt( $( 'studio-height' ).value, 10 );
			if ( ! width || ! height || width < 1 || height < 1 ) { status( 'Dimensions invalides.', 'error' ); return; }
			resizeCanvas( width, height );
		} );
		studio.root.addEventListener( 'click', ( e ) => { if ( e.target === studio.root ) closeStudio(); } );
		document.addEventListener( 'keydown', ( e ) => {
			if ( studio.root.hidden ) return;
			if ( e.key === 'Escape' ) { closeStudio(); return; }
			if ( ( e.ctrlKey || e.metaKey ) && e.key.toLowerCase() === 'z' ) {
				e.preventDefault();
				if ( e.shiftKey ) redo(); else undo();
			}
		} );
		updateHistoryButtons();
	}

	function protectCurrentImportContract() {
		const btn = $( 'import-btn' );
		if ( ! btn ) return;
		btn.addEventListener( 'click', ( event ) => {
			if ( ! anyLocalImages() ) return;
			event.preventDefault();
			event.stopImmediatePropagation();
			showLocalNote( 'Import bloqué : une ou plusieurs images sont modifiées localement. Le prochain lot IMG-06/IMG-07 doit d’abord uploader ces fichiers dans WordPress puis injecter leurs URLs/média IDs dans l’import.' );
			window.scrollTo?.( { top: document.querySelector( '.gallery-main' )?.offsetTop || 0, behavior: 'smooth' } );
		}, true );
	}

	function observeGallery() {
		const thumbs = $( 'gallery-thumbs' );
		if ( ! thumbs ) return;
		const observer = new MutationObserver( () => markLocalState() );
		observer.observe( thumbs, { childList: true, subtree: true, attributes: true, attributeFilter: [ 'src' ] } );
	}

	function init() {
		if ( $( 'cdh-image-studio' ) ) return;
		installStyles();
		studio.root = buildStudio();
		document.addEventListener( 'cdh:edit-external-image', ( event ) => { const detail = event.detail || {}; if ( detail.url ) openStudio( detail.url, { targetId: detail.targetId || '' } ); } );
		injectGalleryControls();
		bindGalleryControls();
		bindStudioUi();
		observeGallery();
	}

	init();
} )();
