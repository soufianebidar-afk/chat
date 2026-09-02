const { spawnSync } = require('child_process');
const path = require('path');
const files = ['page-sku-bridge.test.js', 'content-script.test.js', 'description-lazy.test.js', 'description-ui.test.js', 'editor.test.js', 'background-import.test.js', 'catalog-mapping-ui.test.js', 'workspace-documents-size.test.js', 'open-editor-timeout.test.js'];
for (const file of files) {
  const result = spawnSync(process.execPath, [path.join(__dirname, file)], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log('PASS | all extension stabilization tests');
