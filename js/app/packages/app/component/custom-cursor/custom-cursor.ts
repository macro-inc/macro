import {
  ENABLE_CUSTOM_CURSOR,
  ENABLE_CUSTOM_CURSOR_TEXT_GLYPH_DETECTION,
} from '@core/constant/featureFlags';
import { isMobile } from '@solid-primitives/platform';
import { throttle } from '@solid-primitives/scheduled';
import {
  createEffect,
  createRoot,
  createSignal,
  createUniqueId,
} from 'solid-js';
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
import customCursorCSSFileRaw from './custom-cursor.css?raw';

let defaultCursor: string = '';
let hexColor: string = '';
let cursorCache: Record<string, string> = {};
let currentCursorType: string | null = 'auto';
const styleElements = new Set<HTMLStyleElement>();

export const [customCursorEnabled, setCustomCursorEnabled] = createSignal(true);

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
function deepElementFromPoint(
  x: number,
  y: number,
  root: Document | ShadowRoot = document
): Element | null {
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

  const isOverText = textNodes.some((tn) =>
    isPointInTextLine(tn, clientX, clientY)
  );
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

function replaceColorAttrWithAccent(
  svgContent: string,
  accentHex: string
): string {
  if (!accentHex) return svgContent;
  return svgContent.replace(/%COLOR-ACCENT%/gi, accentHex);
}

// Convert SVG string to data URL cursor CSS
function svgToCursor(
  svgContent: string,
  fallback: string,
  position: string = '11 9'
): string {
  const encodedSvg = encodeURIComponent(svgContent);
  return `url('data:image/svg+xml;utf8,${encodedSvg}') ${position}, ${fallback}`;
}

// Map of cursor states to SVG raw content and fallback cursor
const cursorSvgMap: Record<
  string,
  { svg: string; fallback: string; position: string }
> = {
  // general cursors
  auto: { svg: defaultSvgRaw, fallback: 'auto', position: '11 9' },
  default: { svg: defaultSvgRaw, fallback: 'default', position: '11 9' }, // Will be set dynamically
  none: { svg: '', fallback: 'none', position: '11 9' },
  // link and status cursors
  'context-menu': {
    svg: contextualmenuSvgRaw,
    fallback: 'context-menu',
    position: '11 9',
  },
  help: { svg: helpSvgRaw, fallback: 'help', position: '11 9' },
  pointer: { svg: handpointingSvgRaw, fallback: 'pointer', position: '11 9' },
  progress: { svg: busySvgRaw, fallback: 'progress', position: '11 9' },
  wait: { svg: busySvgRaw, fallback: 'wait', position: '11 9' },
  // selection cursors
  cell: { svg: cellSvgRaw, fallback: 'cell', position: '11 9' },
  crosshair: { svg: crossSvgRaw, fallback: 'crosshair', position: '11 9' },
  text: { svg: textcursorSvgRaw, fallback: 'text', position: '16 16' },
  'vertical-text': {
    svg: textcursorverticalSvgRaw,
    fallback: 'vertical-text',
    position: '11 9',
  },
  // drag-and-drop cursors
  alias: { svg: aliasSvgRaw, fallback: 'alias', position: '11 9' },
  copy: { svg: copySvgRaw, fallback: 'copy', position: '11 9' },
  move: { svg: moveSvgRaw, fallback: 'move', position: '11 9' },
  'no-drop': { svg: notallowedSvgRaw, fallback: 'no-drop', position: '8 0' },
  'not-allowed': {
    svg: notallowedSvgRaw,
    fallback: 'not-allowed',
    position: '8 0',
  },
  grab: { svg: handopenSvgRaw, fallback: 'grab', position: '11 9' },
  grabbing: { svg: handgrabbingSvgRaw, fallback: 'grabbing', position: '11 9' },
  // resizing and scrolling cursors
  'all-scroll': { svg: moveSvgRaw, fallback: 'all-scroll', position: '11 9' },
  'col-resize': {
    svg: resizeleftrightSvgRaw,
    fallback: 'col-resize',
    position: '16 16',
  },
  'row-resize': {
    svg: resizeupdownSvgRaw,
    fallback: 'row-resize',
    position: '11 9',
  },
  'n-resize': {
    svg: resizenorthSvgRaw,
    fallback: 'n-resize',
    position: '11 9',
  },
  's-resize': {
    svg: resizesouthSvgRaw,
    fallback: 's-resize',
    position: '11 9',
  },
  'e-resize': { svg: resizeeastSvgRaw, fallback: 'e-resize', position: '11 9' },
  'w-resize': { svg: resizewestSvgRaw, fallback: 'w-resize', position: '11 9' },
  'ns-resize': {
    svg: resizenorthsouthSvgRaw,
    fallback: 'ns-resize',
    position: '11 9',
  },
  'ew-resize': {
    svg: resizewesteastSvgRaw,
    fallback: 'ew-resize',
    position: '11 9',
  },
  'ne-resize': {
    svg: resizenortheastSvgRaw,
    fallback: 'ne-resize',
    position: '11 9',
  },
  'nw-resize': {
    svg: resizenorthwestSvgRaw,
    fallback: 'nw-resize',
    position: '11 9',
  },
  'se-resize': {
    svg: resizesoutheastSvgRaw,
    fallback: 'se-resize',
    position: '11 9',
  },
  'sw-resize': {
    svg: resizesouthwestSvgRaw,
    fallback: 'sw-resize',
    position: '11 9',
  },
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
    if (cursorType === 'none') return 'none';
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
    processedSvg = replaceColorAttrWithAccent(processedSvg, hexColor);
  }

  // Convert to cursor CSS
  const cursorCss = svgToCursor(
    processedSvg,
    cursorDef.fallback,
    cursorDef.position
  );
  cursorCache[cacheKey] = cursorCss;
  return cursorCss;
}

const cursorClassPrefix = createUniqueId();
const getCursorClassFromKey = (key: string) => {
  return `${cursorClassPrefix}-${key}`;
};
const allCustomCursorClasses = Object.keys(cursorSvgMap).map((key) =>
  getCursorClassFromKey(key)
);

function generateCustomCursorStyleTextContent(isRoot?: boolean) {
  let styleTextContent = !isRoot ? customCursorCSSFileRaw : '';
  styleTextContent += `html { cursor: ${getCursor('auto')} }`;
  styleTextContent += `:root { `;
  styleTextContent += Object.keys(cursorSvgMap)
    .map((key) => {
      return `
      --cursor-${key}: ${getCursor(key)};
       `;
    })
    .join('');
  styleTextContent += ` }`;
  styleTextContent += Object.keys(cursorSvgMap)
    .map((key) => {
      return `
      .${getCursorClassFromKey(key)} {
      cursor: ${getCursor(key)};
       }`;
    })
    .join('');
  return styleTextContent;
}
function createCustomCursorStylesheetEl(
  element: HTMLElement | ShadowRoot,
  isRoot?: boolean
) {
  const styleEl = document.createElement('style');
  if (isRoot) {
    rootStyleSheet = styleEl;
  }
  styleElements.add(styleEl);
  styleEl.textContent = generateCustomCursorStyleTextContent(isRoot);
  element.appendChild(styleEl);
}

function updateAllCustomCursorStylesheetEls() {
  styleElements.forEach((styleEl) => {
    if (!styleEl.isConnected) {
      styleElements.delete(styleEl);
      return;
    }
    const isRoot = styleEl === rootStyleSheet;
    styleEl.textContent = generateCustomCursorStyleTextContent(isRoot);
  });
}

const clearAllCustomCursorStylesheetEls = () => {
  styleElements.forEach((styleEl) => {
    styleEl.textContent = '';
  });
};

function updateCursor() {
  updateCustomCursor();
  updateAllCustomCursorStylesheetEls();
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

const textNodeMap = new WeakMap<Element, (e: MouseEvent) => void>();

let rootStyleSheet!: HTMLStyleElement;
// Initialize cursor
function initCursor() {
  if (!ENABLE_CUSTOM_CURSOR) return;

  if (isMobile) return;
  updateCustomCursor();

  const isRoot = true;
  createCustomCursorStylesheetEl(document.head, isRoot);
  const holdsDirectTextNode = (target: HTMLElement) => {
    const childNodes = target.childNodes;

    for (let i = 0; i < childNodes.length; i++) {
      const node = childNodes[i];

      if (node.nodeValue && node.nodeName === '#text') return true;
    }

    return false;
  };

  const ifTextNodeThenAddMouseMoveToTarget = (target: HTMLElement) => {
    if (!holdsDirectTextNode(target)) return;

    const onMouseMove =
      textNodeMap.get(target) ||
      ((e: MouseEvent) => {
        // left mouse held down, such as dragging column or scrollbar
        if (e.buttons === 1) {
          return;
        }

        if (!customCursorEnabled()) {
          return;
        }

        const computedStyle = getComputedStyle(e.target as HTMLElement);
        const currentTarget = e.currentTarget as HTMLElement;
        const cursor = extractFallbackCursor(computedStyle.cursor);

        if (computedStyle.userSelect === 'none') {
          currentTarget.removeEventListener('mousemove', onMouseMove);
          return;
        }
        if (cursor !== 'auto' && cursor !== 'text') {
          currentTarget.removeEventListener('mousemove', onMouseMove);
          return;
        }

        if (isOverTextGlyph(e.clientX, e.clientY)) {
          currentTarget.classList.add(getCursorClassFromKey('text'));
        } else {
          target.classList.remove(getCursorClassFromKey('text'));
        }
      });
    textNodeMap.set(target, onMouseMove);
    target.addEventListener('mousemove', onMouseMove, { passive: true });
  };

  // Add mouseover listener to handle text glyph detection
  // The mouseover event should be computationally cheap, just checks if node has as text nodes
  // If it does then that node adds mousemove event that determines the boundary box of the text glyph, that could be expensive
  const onMouseOver = (e: MouseEvent) => {
    if (!customCursorEnabled()) {
      return;
    }

    const target = e.target as HTMLElement;

    if (target.shadowRoot) {
      createCustomCursorStylesheetEl(target.shadowRoot);

      [...target.shadowRoot.children].forEach((child) => {
        ifTextNodeThenAddMouseMoveToTarget(child as HTMLElement);
        child.addEventListener('mouseover', onMouseOver, { passive: true });
      });
      return;
    }
    ifTextNodeThenAddMouseMoveToTarget(target);
  };

  if (ENABLE_CUSTOM_CURSOR_TEXT_GLYPH_DETECTION) {
    document.addEventListener('mouseover', onMouseOver, { passive: true });
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initCursor);
} else {
  initCursor();
}

createRoot(() => {
  if (!ENABLE_CUSTOM_CURSOR) return;

  const throttledUpdateCursor = throttle(updateCursor, 250);

  createEffect(() => {
    const { l, c, h } = themeReactive.a0;
    const _col = `oklch(${l[0]()} ${c[0]()} ${h[0]()}deg)`;
    if (!customCursorEnabled()) {
      clearAllCustomCursorStylesheetEls();
      return;
    }
    throttledUpdateCursor();
  });
});
