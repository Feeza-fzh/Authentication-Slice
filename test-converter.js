/**
 * @file test-converter.js
 * @description Automated test suite to verify token conversion logic in convert-tokens.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  TokenConverter,
  toKebabCase,
  formatColor,
  formatDimension,
  getPrimitiveCssVarName,
  getColorRoleCssVarName
} = require('./convert-tokens.js');

console.log('Running Design Token Converter Test Suite...\n');

// 1. Test String Formatting & Helper Utilities
console.log('[Test 1] Testing Utility Helpers...');
assert.strictEqual(toKebabCase('Primary Color Group'), 'primary-color-group');
assert.strictEqual(toKebabCase('on primary container'), 'on-primary-container');
assert.strictEqual(toKebabCase('  extra small spacing '), 'extra-small-spacing');

assert.strictEqual(formatColor('#8C19DEFF'), '#8c19de');
assert.strictEqual(formatColor('#00000052'), 'rgba(0, 0, 0, 0.32)');
assert.strictEqual(formatColor('#FFFFFFFF'), '#ffffff');

assert.strictEqual(formatDimension(0, 'px'), '0');
assert.strictEqual(formatDimension(16, 'px'), '16px');
assert.strictEqual(formatDimension(1.5, 'rem'), '1.5rem');
console.log('✓ Utility helpers passed.');

// 2. Test Primitive Variable Name Generator
console.log('\n[Test 2] Testing Primitive CSS Var Naming...');
assert.strictEqual(
  getPrimitiveCssVarName('key color group', 'primary key color'),
  '--primitive-color-key-primary-key'
);
assert.strictEqual(
  getPrimitiveCssVarName('primary color group', 'primary100'),
  '--primitive-color-primary-100'
);
assert.strictEqual(
  getPrimitiveCssVarName('neutral variant color group', 'neutralv90'),
  '--primitive-color-neutral-variant-v90'
);
console.log('✓ Primitive variable naming passed.');

// 3. Test Full Design Token JSON Conversion
console.log('\n[Test 3] Testing Full JSON Token Conversion...');
const tokenFilePath = path.join(__dirname, 'design-tokens.tokens.json');
const rawTokens = JSON.parse(fs.readFileSync(tokenFilePath, 'utf-8'));

const converter = new TokenConverter();
const cssOutput = converter.convert(rawTokens);

// Assertions on generated CSS content
assert.ok(cssOutput.includes(':root {'), 'CSS output must contain :root selector');

// Check Primitive colors
assert.ok(cssOutput.includes('--primitive-color-key-primary-key: #8c19de;'), 'Primitive key color converted');
assert.ok(cssOutput.includes('--primitive-color-primary-100: #ffffff;'), 'Primitive primary 100 converted');

// Check Color Roles aliasing to primitive variables
assert.ok(cssOutput.includes('--color-primary: var(--primitive-color-key-primary-key);'), 'Color role primary aliases primitive variable');
assert.ok(cssOutput.includes('--color-on-primary: var(--primitive-color-primary-100);'), 'Color role on-primary aliases primitive variable');
assert.ok(cssOutput.includes('--color-surface: var(--primitive-color-neutral-98);'), 'Color role surface aliases primitive variable');

// Check Spacing
assert.ok(cssOutput.includes('--spacing-extra-small: 4px;'), 'Spacing token converted');
assert.ok(cssOutput.includes('--spacing-base: 16px;'), 'Spacing base token converted');

// Check Typography
assert.ok(cssOutput.includes('--font-body-medium-size: 14px;'), 'Typography body medium size converted');
assert.ok(cssOutput.includes("--font-body-medium-family: 'DM Sans', sans-serif;"), 'Typography font family converted');

// Check Shadows
assert.ok(cssOutput.includes('--shadow-hard: 4px 6px 8px 0 rgba(0, 0, 0, 0.32);'), 'Hard shadow converted');

console.log('✓ Full conversion assertions passed successfully!');

// 4. Test Resolved References Option
console.log('\n[Test 4] Testing --resolve-refs Option...');
const rawValueConverter = new TokenConverter({ resolveReferences: true });
const cssResolved = rawValueConverter.convert(rawTokens);

assert.ok(cssResolved.includes('--color-primary: #8c19de;'), 'Color role primary resolves directly to hex value when option enabled');
console.log('✓ Resolved references option test passed!');

console.log('\n==================================================');
console.log('ALL TESTS PASSED SUCCESSFULLY! 🎉');
console.log('==================================================');
