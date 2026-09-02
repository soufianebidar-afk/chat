'use strict';
const fs = require('fs');
const assert = require('assert');
const path = require('path');
const bg = fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8');
const banner = fs.readFileSync(path.join(__dirname, '..', 'banner.js'), 'utf8');

assert(bg.includes('function sendTabMessageWithTimeout'), 'callback tab-message timeout helper missing');
assert(bg.includes("maxWaitMs: 4200"), 'description preparation must be bounded');
assert(bg.includes("5000"), 'description outer timeout missing');
assert(bg.includes("sendResponse( { ok: true, queued: true } )"), 'CDH_OPEN_EDITOR must ACK immediately');
assert(bg.includes('queueEditorOpen( sourceTabId, message )'), 'editor open must continue asynchronously');
assert(bg.includes('const editorOpenJobs = new Map()'), 'duplicate editor-open jobs are not guarded');
assert(!bg.includes('withTimeout( handleGetConfig(), 1500'), 'open flow must not depend on WordPress /config');

assert(banner.includes('function sendRuntimeMessageCompat'), 'banner callback compatibility helper missing');
assert(banner.includes("els.primary.textContent = 'Préparation…'"), 'preparation state missing');
assert(banner.includes('finally {'), 'button state must be restored in finally');
assert(banner.includes('els.primary.textContent = previousText'), 'button text restore missing');
assert(banner.includes('els.primary.disabled = false'), 'button enabled-state restore missing');
assert(!banner.includes("code:'analysis_timeout'"), 'old long-running banner analysis wait still present');

console.log('PASS | editor opening is acknowledged immediately and cannot lock the AliExpress banner');
