/**
 * @file convert-tokens.js
 * @description Script to convert Figma/Style-Dictionary design tokens JSON to CSS custom properties (variables).
 * 
 * Color System Architecture:
 * - Primitive Colors (Foundations): Base color palettes and key scales. Not intended to be used directly in UI components.
 * - Color Roles (UI Semantic Colors): Purpose-driven semantic colors (primary, surface, container, etc.) meant for UI usage.
 *   These reference Primitive Colors using CSS `var(...)` bindings.
 */

const fs = require('fs');
const path = require('path');

/**
 * Default configuration options for the token converter.
 * @typedef {Object} ConverterOptions
 * @property {string} inputPath - Path to input JSON token file.
 * @property {string} outputPath - Path to output CSS file.
 * @property {string} rootSelector - CSS selector to scope variables under (default: ':root').
 * @property {boolean} resolveReferences - If true, replaces `var(...)` references with resolved raw color values. Default is false (preserves token hierarchy).
 * @property {string} dimensionUnit - Unit for numbers without units (default: 'px').
 * @property {boolean} convert8DigitHex - If true, converts #RRGGBBAA to #RRGGBB when AA=FF, or rgba(...) when AA<FF. Default is true.
 * @property {boolean} includeComments - Whether to include instructional header and section comments in CSS. Default is true.
 */
const DEFAULT_OPTIONS = {
  inputPath: './design-tokens.tokens.json',
  outputPath: './design-tokens.css',
  rootSelector: ':root',
  resolveReferences: false,
  dimensionUnit: 'px',
  convert8DigitHex: true,
  includeComments: true
};

/**
 * Helper function to convert text strings to clean kebab-case slugs suitable for CSS variable names.
 * @param {string} str - Raw token name or section path
 * @returns {string} Kebab-cased string
 */
function toKebabCase(str) {
  return str
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Parses and formats hex colors.
 * Converts 8-digit hex `#RRGGBBAA` to 6-digit `#RRGGBB` if AA is 'ff',
 * or `rgba(r, g, b, a)` if AA < 255.
 * 
 * @param {string} hexStr - Raw hex color string
 * @returns {string} Formatted CSS color string
 */
function formatColor(hexStr) {
  if (typeof hexStr !== 'string' || !hexStr.startsWith('#')) {
    return hexStr;
  }

  // Check for 8-digit hex (#RRGGBBAA)
  if (hexStr.length === 9) {
    const r = parseInt(hexStr.substring(1, 3), 16);
    const g = parseInt(hexStr.substring(3, 5), 16);
    const b = parseInt(hexStr.substring(5, 7), 16);
    const aHex = hexStr.substring(7, 9);
    const a = parseInt(aHex, 16);

    if (aHex.toLowerCase() === 'ff' || a === 255) {
      return `#${hexStr.substring(1, 7).toLowerCase()}`;
    }

    const alphaFloat = Math.round((a / 255) * 100) / 100;
    return `rgba(${r}, ${g}, ${b}, ${alphaFloat})`;
  }

  return hexStr.toLowerCase();
}

/**
 * Formats dimension values (adding unit like `px` if missing).
 * @param {number|string} val - Dimension numerical value or string
 * @param {string} unit - Default unit ('px')
 * @returns {string} Formatted dimension with unit
 */
function formatDimension(val, unit = 'px') {
  if (typeof val === 'number') {
    return val === 0 ? '0' : `${val}${unit}`;
  }
  if (typeof val === 'string') {
    return isNaN(val) ? val : (parseFloat(val) === 0 ? '0' : `${val}${unit}`);
  }
  return String(val);
}

/**
 * Traverses design token tree to extract a deep value by dot-notation JSON path string.
 * Path example: "primitive color groups.key color group.primary key color"
 * 
 * @param {Object} tokens - Complete token object tree
 * @param {string} pathStr - Dot-separated path string or reference string inside `{...}`
 * @returns {Object|null} Token node object
 */
function getTokenByPath(tokens, pathStr) {
  const cleanPath = pathStr.replace(/^\{|\}$/g, '').trim();
  const parts = cleanPath.split('.');
  let current = tokens;

  for (const part of parts) {
    if (current && typeof current === 'object' && current[part] !== undefined) {
      current = current[part];
    } else {
      return null;
    }
  }

  return current;
}

/**
 * Constructs a CSS variable name for a primitive color token.
 * 
 * @param {string} groupKey - e.g., 'primary color group'
 * @param {string} itemKey - e.g., 'primary100' or 'primary key color'
 * @returns {string} Clean CSS variable name (e.g., '--primitive-color-primary-100')
 */
function getPrimitiveCssVarName(groupKey, itemKey) {
  // Clean group name
  let cleanGroup = groupKey.replace(/color group$/i, '').trim();
  cleanGroup = toKebabCase(cleanGroup);

  // Clean item name
  let cleanItem = itemKey.replace(/color$/i, '').trim();

  // If item name starts with the group name, split numerical suffix or strip redundant prefix
  // e.g. group 'primary', item 'primary100' -> '100', or 'neutral-variant', 'neutralv90' -> 'v90'
  if (cleanGroup !== 'key') {
    if (cleanItem.toLowerCase().startsWith(cleanGroup)) {
      const suffix = cleanItem.substring(cleanGroup.length).trim();
      if (suffix) {
        cleanItem = suffix;
      }
    } else if (cleanGroup === 'neutral-variant' && cleanItem.toLowerCase().startsWith('neutral')) {
      const suffix = cleanItem.substring('neutral'.length).trim();
      if (suffix) {
        cleanItem = suffix;
      }
    }
  }

  cleanItem = toKebabCase(cleanItem);

  return `--primitive-color-${cleanGroup}-${cleanItem}`;
}

/**
 * Constructs a CSS variable name for a UI Color Role token.
 * 
 * @param {string} roleKey - e.g., 'on primary container' or 'surface c highest'
 * @returns {string} Clean CSS variable name (e.g., '--color-on-primary-container')
 */
function getColorRoleCssVarName(roleKey) {
  return `--color-${toKebabCase(roleKey)}`;
}

/**
 * Core conversion class that processes tokens and outputs formatted CSS.
 */
class TokenConverter {
  constructor(options = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.tokens = {};
    this.primitiveVarMap = new Map(); // Maps JSON reference path -> CSS var name
    this.cssLines = [];
  }

  /**
   * Main entry point to convert token JSON object into CSS output string.
   * @param {Object} tokenData - Design tokens JSON object
   * @returns {string} Formatted CSS document string
   */
  convert(tokenData) {
    this.tokens = tokenData;
    this.cssLines = [];
    this.primitiveVarMap.clear();

    // Build header documentation
    if (this.options.includeComments) {
      this.cssLines.push('/**',
        ' * ============================================================================',
        ' * DESIGN SYSTEM CSS CUSTOM PROPERTIES (VARIABLES)',
        ' * Automatically generated from design-tokens.tokens.json',
        ' * ============================================================================',
        ' *',
        ' * ARCHITECTURE NOTE:',
        ' * 1. PRIMITIVE COLORS (--primitive-color-*): Raw foundation scales. DO NOT USE DIRECTLY IN UI.',
        ' * 2. COLOR ROLES (--color-*): UI semantic colors. USE THESE FOR COMPONENT STYLING.',
        ' * 3. SPACING (--spacing-*): Dimension tokens for margins, paddings, and layouts.',
        ' * 4. TYPOGRAPHY (--font-*): Typography styling tokens (size, weight, family, line-height).',
        ' * 5. SHADOWS (--shadow-*): Box-shadow effect tokens.',
        ' * ============================================================================',
        ' */',
        ''
      );
    }

    this.cssLines.push(`${this.options.rootSelector} {`);

    // 1. Convert Primitive Colors (Foundations)
    if (this.tokens['primitive color groups']) {
      this.processPrimitiveColors(this.tokens['primitive color groups']);
    }

    // 2. Convert Color Roles (UI Semantic Colors)
    if (this.tokens['color roles']) {
      this.processColorRoles(this.tokens['color roles']);
    }

    // 3. Convert Spacing System
    if (this.tokens['spacing system']) {
      this.processSpacing(this.tokens['spacing system']);
    }

    // 4. Convert Typography
    if (this.tokens['typography']) {
      this.processTypography(this.tokens['typography']);
    }

    // 5. Convert Effects (Shadows)
    if (this.tokens['effect']) {
      this.processEffects(this.tokens['effect']);
    }

    this.cssLines.push('}');
    return this.cssLines.join('\n');
  }

  /**
   * Processes Primitive Color Groups (Foundations)
   */
  processPrimitiveColors(primitiveGroups) {
    if (this.options.includeComments) {
      this.cssLines.push(
        '  /* ==========================================================================',
        '   * 1. PRIMITIVE COLORS (FOUNDATION / PALETTE)',
        '   * --------------------------------------------------------------------------',
        '   * WARNING: Primitive colors are internal design system foundations.',
        '   * DO NOT apply these directly in UI components. Use UI Color Roles instead.',
        '   * ==========================================================================',
        '   */'
      );
    }

    for (const groupKey of Object.keys(primitiveGroups)) {
      const groupObj = primitiveGroups[groupKey];
      if (this.options.includeComments) {
        this.cssLines.push(`  /* --- Primitive Scale: ${groupKey} --- */`);
      }

      for (const itemKey of Object.keys(groupObj)) {
        const token = groupObj[itemKey];
        if (token && token.type === 'color' && token.value) {
          const jsonPath = `primitive color groups.${groupKey}.${itemKey}`;
          const varName = getPrimitiveCssVarName(groupKey, itemKey);
          const rawValue = this.options.convert8DigitHex ? formatColor(token.value) : token.value;

          this.primitiveVarMap.set(jsonPath, varName);
          this.cssLines.push(`  ${varName}: ${rawValue};`);
        }
      }
      this.cssLines.push('');
    }
  }

  /**
   * Processes Color Roles (UI Semantic Colors)
   */
  processColorRoles(colorRoles) {
    if (this.options.includeComments) {
      this.cssLines.push(
        '  /* ==========================================================================',
        '   * 2. COLOR ROLES (UI SEMANTIC COLORS)',
        '   * --------------------------------------------------------------------------',
        '   * RECOMMENDED FOR UI USE:',
        '   * Apply these semantic variables directly to UI components (buttons, cards,',
        '   * text, borders, backgrounds) to ensure proper dark mode and theme adaptability.',
        '   * ==========================================================================',
        '   */'
      );
    }

    for (const roleKey of Object.keys(colorRoles)) {
      const token = colorRoles[roleKey];
      if (token && token.type === 'color' && token.value) {
        const varName = getColorRoleCssVarName(roleKey);
        const refValue = token.value;
        let cssValue = '';

        // Check if value is a reference `{path.to.primitive}`
        if (typeof refValue === 'string' && refValue.startsWith('{') && refValue.endsWith('}')) {
          const targetPath = refValue.replace(/^\{|\}$/g, '').trim();
          const targetVarName = this.primitiveVarMap.get(targetPath);

          if (this.options.resolveReferences) {
            // Resolve directly to target hex color
            const targetToken = getTokenByPath(this.tokens, targetPath);
            cssValue = targetToken ? formatColor(targetToken.value) : refValue;
          } else if (targetVarName) {
            // Link to primitive CSS variable
            cssValue = `var(${targetVarName})`;
          } else {
            // Fallback if target CSS var not found
            const targetToken = getTokenByPath(this.tokens, targetPath);
            cssValue = targetToken ? formatColor(targetToken.value) : refValue;
          }
        } else {
          cssValue = this.options.convert8DigitHex ? formatColor(refValue) : refValue;
        }

        const commentStr = token.description ? ` /* ${token.description} */` : '';
        this.cssLines.push(`  ${varName}: ${cssValue};${commentStr}`);
      }
    }
    this.cssLines.push('');
  }

  /**
   * Processes Spacing Tokens
   */
  processSpacing(spacingObj) {
    if (this.options.includeComments) {
      this.cssLines.push(
        '  /* ==========================================================================',
        '   * 3. SPACING SYSTEM',
        '   * ==========================================================================',
        '   */'
      );
    }

    for (const spacingKey of Object.keys(spacingObj)) {
      const token = spacingObj[spacingKey];
      if (token && token.value !== undefined) {
        const varName = `--spacing-${toKebabCase(spacingKey.replace(/spacing$/i, ''))}`;
        const cssValue = formatDimension(token.value, this.options.dimensionUnit);
        this.cssLines.push(`  ${varName}: ${cssValue};`);
      }
    }
    this.cssLines.push('');
  }

  /**
   * Processes Typography Tokens
   */
  processTypography(typographyObj) {
    if (this.options.includeComments) {
      this.cssLines.push(
        '  /* ==========================================================================',
        '   * 4. TYPOGRAPHY TOKENS',
        '   * ==========================================================================',
        '   */'
      );
    }

    for (const typeKey of Object.keys(typographyObj)) {
      const spec = typographyObj[typeKey];
      const prefix = `--font-${toKebabCase(typeKey)}`;

      if (this.options.includeComments) {
        this.cssLines.push(`  /* Typography Style: ${typeKey} */`);
      }

      const family = spec.fontFamily ? spec.fontFamily.value : null;
      const size = spec.fontSize ? formatDimension(spec.fontSize.value, this.options.dimensionUnit) : null;
      const weight = spec.fontWeight ? spec.fontWeight.value : null;
      const lineHeight = spec.lineHeight ? formatDimension(spec.lineHeight.value, this.options.dimensionUnit) : null;
      const letterSpacing = spec.letterSpacing ? formatDimension(spec.letterSpacing.value, this.options.dimensionUnit) : null;

      if (family) this.cssLines.push(`  ${prefix}-family: '${family}', sans-serif;`);
      if (size) this.cssLines.push(`  ${prefix}-size: ${size};`);
      if (weight) this.cssLines.push(`  ${prefix}-weight: ${weight};`);
      if (lineHeight) this.cssLines.push(`  ${prefix}-line-height: ${lineHeight};`);
      if (letterSpacing) this.cssLines.push(`  ${prefix}-letter-spacing: ${letterSpacing};`);

      // Shorthand font property helper if family, weight, size, lineHeight exist
      if (family && size && weight && lineHeight) {
        this.cssLines.push(`  ${prefix}: ${weight} ${size}/${lineHeight} '${family}', sans-serif;`);
      }

      this.cssLines.push('');
    }
  }

  /**
   * Processes Effect (Shadow) Tokens
   */
  processEffects(effectsObj) {
    if (this.options.includeComments) {
      this.cssLines.push(
        '  /* ==========================================================================',
        '   * 5. EFFECTS & SHADOWS',
        '   * ==========================================================================',
        '   */'
      );
    }

    for (const effectKey of Object.keys(effectsObj)) {
      const token = effectsObj[effectKey];
      if (token && token.type === 'custom-shadow' && token.value) {
        const val = token.value;
        const varName = `--shadow-${toKebabCase(effectKey.replace(/shadow$/i, ''))}`;

        const offsetX = formatDimension(val.offsetX || 0, this.options.dimensionUnit);
        const offsetY = formatDimension(val.offsetY || 0, this.options.dimensionUnit);
        const radius = formatDimension(val.radius || 0, this.options.dimensionUnit);
        const spread = formatDimension(val.spread || 0, this.options.dimensionUnit);
        const color = this.options.convert8DigitHex ? formatColor(val.color) : val.color;

        // Box shadow CSS format: offsetX offsetY radius spread color
        const boxShadowStr = `${offsetX} ${offsetY} ${radius} ${spread} ${color}`;
        this.cssLines.push(`  ${varName}: ${boxShadowStr};`);
      }
    }
    this.cssLines.push('');
  }
}

/**
 * CLI runner when executed directly from the terminal.
 */
function main() {
  const args = process.argv.slice(2);

  // Parse command line arguments
  const options = { ...DEFAULT_OPTIONS };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--input' || arg === '-i') {
      options.inputPath = args[++i];
    } else if (arg === '--output' || arg === '-o') {
      options.outputPath = args[++i];
    } else if (arg === '--root-selector') {
      options.rootSelector = args[++i];
    } else if (arg === '--resolve-refs' || arg === '-r') {
      options.resolveReferences = true;
    } else if (arg === '--unit') {
      options.dimensionUnit = args[++i];
    } else if (arg === '--no-comments') {
      options.includeComments = false;
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
Design Token to CSS Variable Converter
Usage: node convert-tokens.js [options]

Options:
  -i, --input <path>      Input tokens JSON file path (default: ./design-tokens.tokens.json)
  -o, --output <path>     Output CSS file path (default: ./design-tokens.css)
  --root-selector <sel>   CSS root selector (default: :root)
  -r, --resolve-refs      Resolve references directly to hex values instead of var(...)
  --unit <unit>           Unit for numerical dimensions (default: px)
  --no-comments           Omit header and section comments in output CSS
  -h, --help              Show this help message
`);
      process.exit(0);
    }
  }

  // Resolve absolute paths
  const resolvedInputPath = path.resolve(process.cwd(), options.inputPath);
  const resolvedOutputPath = path.resolve(process.cwd(), options.outputPath);

  console.log(`[TokenConverter] Reading design tokens from: ${resolvedInputPath}`);

  if (!fs.existsSync(resolvedInputPath)) {
    console.error(`[Error] Input file does not exist: ${resolvedInputPath}`);
    process.exit(1);
  }

  try {
    const rawContent = fs.readFileSync(resolvedInputPath, 'utf-8');
    const tokenData = JSON.parse(rawContent);

    const converter = new TokenConverter(options);
    const cssContent = converter.convert(tokenData);

    // Create output directory if it doesn't exist
    const outputDir = path.dirname(resolvedOutputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    fs.writeFileSync(resolvedOutputPath, cssContent, 'utf-8');
    console.log(`[TokenConverter] Successfully generated CSS variables file: ${resolvedOutputPath}`);
  } catch (err) {
    console.error(`[TokenConverter] Conversion failed:`, err.message);
    process.exit(1);
  }
}

// Export programmatic API and run CLI if executed directly
if (require.main === module) {
  main();
}

module.exports = {
  TokenConverter,
  toKebabCase,
  formatColor,
  formatDimension,
  getPrimitiveCssVarName,
  getColorRoleCssVarName,
  DEFAULT_OPTIONS
};
