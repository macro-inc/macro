import type { Plugin } from 'vite';

/**
 * Vite plugin that transforms cursor declarations to use CSS variables
 *
 * Transforms: cursor: grab; → cursor: var(--cursor-grab, grab);
 *
 * Runs after lightningcss processes CSS, so it works with lightningcss transformer
 */

// List of all standard cursor values that should be transformed
const cursorValues = new Set([
  'auto',
  'default',
  'none',
  'context-menu',
  'help',
  'pointer',
  'progress',
  'wait',
  'cell',
  'crosshair',
  'text',
  'vertical-text',
  'alias',
  'copy',
  'move',
  'no-drop',
  'not-allowed',
  'grab',
  'grabbing',
  'all-scroll',
  'col-resize',
  'row-resize',
  'n-resize',
  's-resize',
  'e-resize',
  'w-resize',
  'ne-resize',
  'nw-resize',
  'se-resize',
  'sw-resize',
  'ew-resize',
  'ns-resize',
  'nesw-resize',
  'nwse-resize',
  'zoom-in',
  'zoom-out',
]);

/**
 * Transform a cursor value to use CSS variable if it's a standard cursor value
 */
function transformCursorValue(value: string): string {
  // Skip if already using CSS variables
  if (value.includes('var(')) {
    return value;
  }

  // Skip complex values like url(...) or other function calls
  if (value.includes('(') && !value.startsWith('var(')) {
    return value;
  }

  // Handle multiple cursor values (fallback chain)
  const values = value
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
  const transformedValues = values.map((v) => {
    if (cursorValues.has(v)) {
      const varName = `--cursor-${v}`;
      return `var(${varName})`;
    }
    return v;
  });

  if (transformedValues.some((tv, i) => tv !== values[i])) {
    return transformedValues.join(', ');
  }

  return value;
}

/**
 * Transform cursor declarations in CSS content
 */
function transformCssContent(css: string): string {
  // Match cursor declarations with !important support
  // This regex matches: cursor: <value> [ !important];
  const cursorRegex = /cursor\s*:\s*([^;!]+?)(\s+!important)?\s*;/gi;

  return css.replace(cursorRegex, (match, value, important = '') => {
    const transformedValue = transformCursorValue(value.trim());
    return `cursor: ${transformedValue}${important};`;
  });
}

export function vitePluginCursorOverride(): Plugin {
  return {
    name: 'vite-plugin-cursor-override',
    enforce: 'post', // Run after lightningcss processes CSS

    // Transform CSS after lightningcss is done
    transform(code, id) {
      // Only process CSS files
      if (!id.match(/\.(css|scss|sass|less|styl)$/)) {
        return null;
      }

      // Debug: log when we process a CSS file
      if (process.env.DEBUG_CURSOR_PLUGIN) {
        console.log(`[cursor-override] Transforming CSS file: ${id}`);
      }

      // Transform cursor declarations
      const transformed = transformCssContent(code);

      // Only return if something changed
      if (transformed !== code) {
        if (process.env.DEBUG_CURSOR_PLUGIN) {
          console.log(`[cursor-override] Transformed cursor values in: ${id}`);
        }
        return {
          code: transformed,
          map: null,
        };
      }

      return null;
    },
  };
}
