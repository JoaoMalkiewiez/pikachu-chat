const js = require('@eslint/js');
const globals = require('globals');
module.exports = [
  { ignores: ['node_modules/**'] },
  js.configs.recommended,
  { files: ['**/*.js', '**/*.cjs'], languageOptions: { ecmaVersion: 2024, sourceType: 'commonjs', globals: globals.node }, rules: { 'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }], 'no-empty': ['error', { allowEmptyCatch: true }] } },
  { files: ['tests/browser.cjs'], languageOptions: { globals: { ...globals.browser, ...globals.node, ws: 'readonly', viewerPeer: 'readonly', sharePeers: 'readonly' } } },
  { files: ['public/app.js'], languageOptions: { sourceType: 'script', globals: globals.browser }, rules: { 'no-unused-vars': ['error', { varsIgnorePattern: '^(login|register)$', caughtErrors: 'none' }] } },
];
