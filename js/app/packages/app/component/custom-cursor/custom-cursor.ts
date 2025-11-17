import { getCustomCursorEnabled } from '@app/util/cursor';
import { isMobile } from "@solid-primitives/platform";
import { createEffect, createRoot } from 'solid-js';
import { themeReactive } from '../../../block-theme/signals/themeReactive';
import busySvgRaw from './cursor-svg/busy.svg?raw';
import cellSvgRaw from './cursor-svg/cell.svg?raw';
import contextualmenuSvgRaw from './cursor-svg/contextualmenu.svg?raw';
import copySvgRaw from './cursor-svg/copy.svg?raw';
import crossSvgRaw from './cursor-svg/cross.svg?raw';
import defaultSvgRaw from './cursor-svg/default.svg?raw';
import handgrabbingSvgRaw from './cursor-svg/handgrabbing.svg?raw';
import handopenSvgRaw from './cursor-svg/handopen.svg?raw';
import handpointingSvgRaw from './cursor-svg/handpointing.svg?raw';
import helpSvgRaw from './cursor-svg/help.svg?raw';
// Import cursor SVGs as raw text so we can replace white fills with accent color
import aliasSvgRaw from './cursor-svg/makealias.svg?raw';
import moveSvgRaw from './cursor-svg/move.svg?raw';
import notallowedSvgRaw from './cursor-svg/notallowed.svg?raw';
// import resizedownSvgRaw from './cursor-svg/resizedown.svg?raw';
import resizeeastSvgRaw from './cursor-svg/resizeeast.svg?raw';
// import resizeleftSvgRaw from './cursor-svg/resizeleft.svg?raw';
import resizeleftrightSvgRaw from './cursor-svg/resizeleftright.svg?raw';
import resizenorthSvgRaw from './cursor-svg/resizenorth.svg?raw';
import resizenortheastSvgRaw from './cursor-svg/resizenortheast.svg?raw';
import resizenortheastsouthwestSvgRaw from './cursor-svg/resizenortheastsouthwest.svg?raw';
import resizenorthsouthSvgRaw from './cursor-svg/resizenorthsouth.svg?raw';
import resizenorthwestSvgRaw from './cursor-svg/resizenorthwest.svg?raw';
// import resizenorthwestsoutheastSvgRaw from './cursor-svg/resizenorthwestsoutheast.svg?raw';
// import resizerightSvgRaw from './cursor-svg/resizeright.svg?raw';
import resizesouthSvgRaw from './cursor-svg/resizesouth.svg?raw';
import resizesoutheastSvgRaw from './cursor-svg/resizesoutheast.svg?raw';
import resizesouthwestSvgRaw from './cursor-svg/resizesouthwest.svg?raw';
// import resizeupSvgRaw from './cursor-svg/resizeup.svg?raw';
import resizeupdownSvgRaw from './cursor-svg/resizeupdown.svg?raw';
import resizewestSvgRaw from './cursor-svg/resizewest.svg?raw';
import resizewesteastSvgRaw from './cursor-svg/resizewesteast.svg?raw';
import textcursorSvgRaw from './cursor-svg/textcursor.svg?raw';
import textcursorverticalSvgRaw from './cursor-svg/textcursorvertical.svg?raw';
import zoominSvgRaw from './cursor-svg/zoomin.svg?raw';
import zoomoutSvgRaw from './cursor-svg/zoomout.svg?raw';

let cursorStyleEl: HTMLStyleElement | null = null;
let defaultCursor: string = '';
let hexColor: string = '';
let cursorCache: Record<string, string> = {};
let currentCursorType: string | null = null;
const shadowRoots = new Set<ShadowRoot>()
let overridedCursorTargetEl: HTMLElement | null = null
const overrideCursorAttr = 'data-override-cursor'
// const overrideCursorSelector = `[${overrideCursorAttr}]`
const overrideCursorSelector = `*`

// Get or create style elements in all matching shadow roots
function getShadowRootStyleEls(): HTMLStyleElement[] {
  const styleElements: HTMLStyleElement[] = [];

  for (const shadowRoot of shadowRoots) {
    let styleEl = shadowRoot.querySelector('style');
    if (!styleEl) {
      styleEl = document.createElement('style');
      shadowRoot.appendChild(styleEl);
    }
    styleElements.push(styleEl);
  }

  return styleElements;
}

// Extract fallback cursor from custom cursor string (e.g., 'url(...) 11 9, auto' -> 'auto')
function extractFallbackCursor(cursor: string): string {
  // If cursor is a custom cursor (starts with 'url('), extract the fallback
  if (cursor.trim().startsWith('url(')) {
    // Pattern: url(...) <hotspot>, <fallback>
    // Extract everything after the last comma
    const lastCommaIndex = cursor.lastIndexOf(',');
    if (lastCommaIndex !== -1) {
      const fallback = cursor.substring(lastCommaIndex + 1).trim();
      return fallback || cursor;
    }
  }
  return cursor;
}

// Recursively find element at point, traversing into shadow roots
function deepElementFromPoint(x: number, y: number, root: Document | ShadowRoot = document): Element | null {
  const el = root.elementFromPoint(x, y);
  if (!el) return null;

  if (el.shadowRoot) {
    const deeper = deepElementFromPoint(x, y, el.shadowRoot);
    return deeper || el;
  }

  return el;
}

// Get all text nodes from an element
function getTextNodes(el: Element): Text[] {
  const nodes: Text[] = [];
  const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
    acceptNode(node: Node) {
      return (node.nodeValue?.trim().length ?? 0) > 0
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT;
    },
  });

  let n: Node | null;
  // biome-ignore lint/suspicious/noAssignInExpressions: <explanation_for_suppression>
  while ((n = tw.nextNode())) {
    nodes.push(n as Text);
  }
  return nodes;
}

// Check if a point is within a text node's bounding rects
function isPointInTextLine(textNode: Text, x: number, y: number): boolean {
  const range = document.createRange();
  range.setStart(textNode, 0);
  range.setEnd(textNode, textNode.length);

  const rects = range.getClientRects();
  for (const r of rects) {
    if (y >= r.top && y <= r.bottom && x >= r.left && x <= r.right) {
      return true;
    }
  }
  return false;
}

// Detect if mouse is over text glyph (I-beam cursor)
function isOverTextGlyph(clientX: number, clientY: number): boolean {
  const node = deepElementFromPoint(clientX, clientY);
  if (!node) return false;

  const textNodes = getTextNodes(node);
  if (!textNodes.length) return false;

  const isOverText = textNodes.some((tn) => isPointInTextLine(tn, clientX, clientY));
  return isOverText;
}

// Convert CSS color (oklch/rgb/etc) to hex using canvas
function getHexColor(cssColor: string): string {
  if (!cssColor) return '';

  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  ctx.fillStyle = cssColor;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  return '#' + [r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

// Replace white fills (#fff, #FFF, #ffffff, #FFFFFF) with accent color
function replaceWhiteFill(svgContent: string, accentHex: string): string {
  if (!accentHex) return svgContent;
  // Replace all variations of white fill (case-insensitive, with single or double quotes)
  return svgContent
    .replace(/fill=["']#fff["']/gi, (match) => {
      const quote = match.includes('"') ? '"' : "'";
      return `fill=${quote}${accentHex}${quote}`;
    })
    .replace(/stroke=["']#fff["']/gi, (match) => {
      const quote = match.includes('"') ? '"' : "'";
      return `stroke=${quote}${accentHex}${quote}`;
    })
    .replace(/stroke=["']#ffffff["']/gi, (match) => {
      const quote = match.includes('"') ? '"' : "'";
      return `stroke=${quote}${accentHex}${quote}`;
    })
    .replace(/fill=["']#ffffff["']/gi, (match) => {
      const quote = match.includes('"') ? '"' : "'";
      return `fill=${quote}${accentHex}${quote}`;
    });
}

// Convert SVG string to data URL cursor CSS
function svgToCursor(svgContent: string, fallback: string, position: string = '11 9'): string {
  const encodedSvg = encodeURIComponent(svgContent);
  return `url('data:image/svg+xml;utf8,${encodedSvg}') ${position}, ${fallback}`;
}

// Map of cursor states to SVG raw content and fallback cursor
const cursorSvgMap: Record<string, { svg: string; fallback: string; position: string }> = {
  // general cursors
  auto: { svg: defaultSvgRaw, fallback: 'auto', position: '11 9' },
  default: { svg: defaultSvgRaw, fallback: 'auto', position: '11 9' }, // Will be set dynamically
  none: { svg: '', fallback: 'none', position: '11 9' },
  // link and status cursors
  'context-menu': { svg: contextualmenuSvgRaw, fallback: 'context-menu', position: '11 9' },
  help: { svg: helpSvgRaw, fallback: 'help', position: '11 9' },
  pointer: { svg: handpointingSvgRaw, fallback: 'pointer', position: '11 9' },
  progress: { svg: busySvgRaw, fallback: 'progress', position: '11 9' },
  wait: { svg: busySvgRaw, fallback: 'wait', position: '11 9' },
  // selection cursors
  cell: { svg: cellSvgRaw, fallback: 'cell', position: '11 9' },
  crosshair: { svg: crossSvgRaw, fallback: 'crosshair', position: '11 9' },
  text: { svg: textcursorSvgRaw, fallback: 'text', position: '16 16' },
  'vertical-text': { svg: textcursorverticalSvgRaw, fallback: 'vertical-text', position: '11 9' },
  // drag-and-drop cursors
  alias: { svg: aliasSvgRaw, fallback: 'alias', position: '11 9' },
  copy: { svg: copySvgRaw, fallback: 'copy', position: '11 9' },
  move: { svg: moveSvgRaw, fallback: 'move', position: '11 9' },
  'no-drop': { svg: notallowedSvgRaw, fallback: 'no-drop', position: '8 0' },
  'not-allowed': { svg: notallowedSvgRaw, fallback: 'not-allowed', position: '8 0' },
  grab: { svg: handopenSvgRaw, fallback: 'grab', position: '11 9' },
  grabbing: { svg: handgrabbingSvgRaw, fallback: 'grabbing', position: '11 9' },
  // resizing and scrolling cursors
  'all-scroll': { svg: moveSvgRaw, fallback: 'all-scroll', position: '11 9' },
  'col-resize': { svg: resizeleftrightSvgRaw, fallback: 'col-resize', position: '16 16' },
  'row-resize': { svg: resizeupdownSvgRaw, fallback: 'row-resize', position: '11 9' },
  'n-resize': { svg: resizenorthSvgRaw, fallback: 'n-resize', position: '11 9' },
  's-resize': { svg: resizesouthSvgRaw, fallback: 's-resize', position: '11 9' },
  'e-resize': { svg: resizeeastSvgRaw, fallback: 'e-resize', position: '11 9' },
  'w-resize': { svg: resizewestSvgRaw, fallback: 'w-resize', position: '11 9' },
  'ns-resize': { svg: resizenorthsouthSvgRaw, fallback: 'ns-resize', position: '11 9' },
  'ew-resize': { svg: resizewesteastSvgRaw, fallback: 'ew-resize', position: '11 9' },
  'ne-resize': { svg: resizenortheastSvgRaw, fallback: 'ne-resize', position: '11 9' },
  'nw-resize': { svg: resizenorthwestSvgRaw, fallback: 'nw-resize', position: '11 9' },
  'se-resize': { svg: resizesoutheastSvgRaw, fallback: 'se-resize', position: '11 9' },
  'sw-resize': { svg: resizesouthwestSvgRaw, fallback: 'sw-resize', position: '11 9' },
  'nesw-resize': {
    svg: resizenortheastsouthwestSvgRaw,
    fallback: 'nesw-resize',
    position: '11 9',
  },
  // zooming cursors
  'zoom-in': { svg: zoominSvgRaw, fallback: 'zoom-in', position: '11 9' },
  'zoom-out': { svg: zoomoutSvgRaw, fallback: 'zoom-out', position: '11 9' },
};

// Map of cursor states to custom cursor URLs (dynamically generated)
const cursorMap: Record<string, string> = {};

// Get cursor CSS for a given cursor type
function getCursor(cursorType: string): string {
  const cursorDef = cursorSvgMap[cursorType];
  if (!cursorDef) return cursorMap.default || '';

  if (!cursorDef.svg) {
    // For auto, none, all-scroll - return empty or fallback
    if (cursorType === 'auto') return cursorMap.default || '';
    if (cursorType === 'none') return '';
    return '';
  }

  // Check cache first
  const cacheKey = `${cursorType}-${hexColor}`;
  if (cursorCache[cacheKey]) {
    return cursorCache[cacheKey];
  }

  // Process SVG: replace white fills with accent color
  let processedSvg = cursorDef.svg;
  if (hexColor) {
    processedSvg = replaceWhiteFill(processedSvg, hexColor);
  }

  // Convert to cursor CSS
  const cursorCss = svgToCursor(processedSvg, cursorDef.fallback, cursorDef.position);
  cursorCache[cacheKey] = cursorCss;
  return cursorCss;
}


function updateCursorStyle() {
  if (!currentCursorType) return
  const cursor = getCursor(currentCursorType)


  const cursorStyle = cursor ? `${overrideCursorSelector} { cursor: ${cursor} !important; }` : '';

  if (cursor) {
    cursorStyleEl!.textContent = cursorStyle;
    const shadowStyleEls = getShadowRootStyleEls();
    for (const shadowStyleEl of shadowStyleEls) {
      shadowStyleEl.textContent = cursorStyle;
    }
  } else {
    cursorStyleEl!.textContent = '';
    const shadowStyleEls = getShadowRootStyleEls();
    for (const shadowStyleEl of shadowStyleEls) {
      shadowStyleEl.textContent = '';
    }
  }
}

function updateCursor() {
  updateCustomCursor()
  updateCursorStyle()
}

function updateCustomCursor() {
  const { l, c, h } = themeReactive.a0;
  const col = `oklch(${l[0]()} ${c[0]()} ${h[0]()}deg)`;

  const accentColor = col;
  if (!accentColor) {
    defaultCursor = '';
    hexColor = '';
    cursorCache = {}; // Clear cache when accent color is removed
    cursorMap.default = '';
    return;
  }

  // Convert CSS color to hex
  const newHexColor = getHexColor(accentColor);

  // If hex color changed, clear cache and update
  if (newHexColor !== hexColor) {
    hexColor = newHexColor;
    cursorCache = {}; // Clear cache when accent color changes
  }

  // Use the default cursor SVG with accent color for white fill
  const svgContent = `<svg height="32" viewBox="0 0 32 32" width="32" xmlns="http://www.w3.org/2000/svg"><g fill="none" fill-rule="evenodd" transform="translate(10 7)"><path id="outline" d="m6.148 18.473 1.863-1.003 1.615-.839-2.568-4.816h4.332l-11.379-11.408v16.015l3.316-3.221z" fill="${hexColor}"/><path d="m6.431 17 1.765-.941-2.775-5.202h3.604l-8.025-8.043v11.188l2.53-2.442z" fill="#000"/></g></svg>`;
  const encodedSvg = encodeURIComponent(svgContent);
  // Hot spot is at the tip of the cursor pointer, accounting for the translate(10 7) transform
  defaultCursor = `url('data:image/svg+xml;utf8,${encodedSvg}') 11 9, auto`;
  cursorMap.default = defaultCursor;
}



const clearCursorOverrideStyle = () => {
  cursorStyleEl!.textContent = '';
  const shadowStyleEls = getShadowRootStyleEls();
  for (const shadowStyleEl of shadowStyleEls) {
    shadowStyleEl.textContent = '';
  }
}


// Initialize cursor
function initCursor() {
  if (isMobile) return
  updateCustomCursor()

  // Initialize cursor style element
  if (!cursorStyleEl) {
    cursorStyleEl = document.createElement('style');
    cursorStyleEl.id = 'custom-cursor-style';
    document.head.appendChild(cursorStyleEl);
  }


  // Add mousemove listener to handle cursor states and text glyph detection
  const onMouseMove = (e: MouseEvent) => {
    if (!getCustomCursorEnabled()) {
      clearCursorOverrideStyle()
      return;
    }

    const target = e.target as Element;

    if (target.shadowRoot) {
      shadowRoots.add(target.shadowRoot);
      [...target.shadowRoot.children].forEach(child => {
        child.addEventListener('mousemove', onMouseMove)
      })
      return
    }


    clearCursorOverrideStyle()

    const targetComputedStyle = getComputedStyle(target)
    const computedCursor = targetComputedStyle.cursor;
    const computedUserSelect = targetComputedStyle.userSelect;
    // TODO: maybe use attribute selector instead of wild card selector to improve perf
    // target.setAttribute(overrideCursorAttr, '')
    // if (target !== overridedCursorTargetEl) {
    //   overridedCursorTargetEl?.removeAttribute(overrideCursorAttr)
    // }
    // overridedCursorTargetEl = target as HTMLElement

    // Extract fallback cursor if computed cursor is a custom cursor string
    const baseCursor = extractFallbackCursor(computedCursor);

    let inferredCursorType: string | null = null;

    // Use inferred cursor type if available, otherwise use extracted fallback cursor
    let cs = inferredCursorType || baseCursor;

    // Only use text glyph detection when cursor is 'auto'
    if (cs === 'auto' && isOverTextGlyph(e.clientX, e.clientY)) {
      if (computedUserSelect === 'none') {
        cs = 'default';
      } else {
        cs = 'text';
      }
      if (target.tagName === 'BUTTON' || target.closest('button')) {
        cs = 'default'
      }
    }
    currentCursorType = cs

    // TODO: Only update if cursor type changed
    // if (cs === currentCursorType) {
    //   return;
    // }

    updateCursorStyle()
  }

  document.addEventListener('mousemove', onMouseMove);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initCursor);
} else {
  initCursor();
}

// Watch for theme changes and preference changes
let lastAccentColor = '';
let lastCursorEnabled = getCustomCursorEnabled();

createRoot(() => {
  createEffect(() => {
    const { l, c, h } = themeReactive.a0;
    const col = `oklch(${l[0]()} ${c[0]()} ${h[0]()}deg)`;

    const currentAccentColor = col;
    const currentCursorEnabled = getCustomCursorEnabled();

    if (
      (currentAccentColor && currentAccentColor !== lastAccentColor) ||
      currentCursorEnabled !== lastCursorEnabled
    ) {
      lastAccentColor = currentAccentColor;
      lastCursorEnabled = currentCursorEnabled;

      updateCursor()
    }
  })
})

// Listen for immediate preference changes
window.addEventListener('cursor-preference-changed', () => {
  lastCursorEnabled = getCustomCursorEnabled();
  updateCustomCursor();
});