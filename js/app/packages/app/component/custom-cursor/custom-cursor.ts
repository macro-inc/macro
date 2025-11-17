
import { getCustomCursorEnabled } from '@app/util/cursor';
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

// Get or create style elements in all matching shadow roots
function getShadowRootStyleEl(selector: string): HTMLStyleElement[] {
  const containers = document.querySelectorAll(selector);
  const styleElements: HTMLStyleElement[] = [];

  for (const container of containers) {
    const shadowRoot = container.shadowRoot;
    if (!shadowRoot) continue;

    let styleEl = shadowRoot.querySelector('style');
    if (!styleEl) {
      styleEl = document.createElement('style');
      shadowRoot.appendChild(styleEl);
    }
    styleElements.push(styleEl);
  }

  return styleElements;
}

// Check if element is inside an email container shadow root
function isInsideEmailShadowRoot(element: Element): boolean {
  let current: Element | null = element;
  while (current) {
    const root = current.getRootNode();
    if (root instanceof ShadowRoot) {
      const host = root.host;
      if (host.hasAttribute('data-email-container')) {
        return true;
      }
    }
    current = current.parentElement;
  }
  return false;
}

// Infer cursor type based on element tag
function inferCursorFromElement(element: Element): string | null {
  const tagName = element.tagName.toLowerCase();

  // Links and buttons should be pointer
  if (tagName === 'a' || tagName === 'button') {
    return 'pointer';
  }

  // Input fields and textareas should be text cursor
  if (tagName === 'input' || tagName === 'textarea') {
    const inputType = (element as HTMLInputElement).type;
    if (inputType === 'text' || inputType === 'email' || inputType === 'password' || inputType === 'search' || inputType === 'url' || inputType === 'tel' || !inputType) {
      return 'text';
    }
    return null;
  }

  // Contenteditable elements should be text cursor
  if ((element as HTMLElement).contentEditable === 'true') {
    return 'text';
  }

  // Images might be move or default
  if (tagName === 'img') {
    return null; // Let CSS handle it
  }

  return null;
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

// Detect if mouse is over text glyph (I-beam cursor)
function isOverTextGlyph(clientX: number, clientY: number): boolean {
  const range =
    (document as any).caretRangeFromPoint?.(clientX, clientY) ||
    (document.caretPositionFromPoint &&
      (() => {
        const pos = document.caretPositionFromPoint(clientX, clientY);
        if (!pos) return null;
        const r = document.createRange();
        r.setStart(pos.offsetNode, pos.offset);
        r.setEnd(pos.offsetNode, pos.offset);
        return r;
      })());

  if (!range) return false;

  const node = range.startContainer;
  if (node.nodeType !== Node.TEXT_NODE) {
    // Not even in a text node → definitely not "text hovered"
    return false;
  }

  const textNode = node;

  // Build a range that spans the entire text node
  const fullRange = document.createRange();
  fullRange.setStart(textNode, 0);
  fullRange.setEnd(textNode, textNode.length);

  const rects = Array.from(fullRange.getClientRects());
  if (!rects.length) return false;

  // Find all rects whose vertical band covers the mouse Y
  const lineRects = rects.filter(
    (r) => clientY >= r.top && clientY <= r.bottom
  );
  if (!lineRects.length) {
    // Above/below the line box → not text
    return false;
  }

  // Merge those rects horizontally into one line span
  const left = Math.min(...lineRects.map((r) => r.left));
  const right = Math.max(...lineRects.map((r) => r.right));

  const isOverTextLine = clientX >= left && clientX <= right;
  return isOverTextLine;
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

// Map of cursor states to custom cursor URLs (dynamically generated)
const cursorMap: Record<string, string> = {};

function updateDefaultCursor() {
  if (!document.body || !document.head) return;

  const accentColor = getComputedStyle(document.documentElement)
    .getPropertyValue('--color-accent')
    .trim();
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

function updateCursor() {
  if (!document.body || !document.head) return;

  const enabled = getCustomCursorEnabled();
  if (!enabled) {
    if (cursorStyleEl) {
      cursorStyleEl.textContent = '';
    }
    const shadowStyleEls = getShadowRootStyleEl('[data-email-container]');
    for (const shadowStyleEl of shadowStyleEls) {
      shadowStyleEl.textContent = '';
    }
    document.body.style.cursor = '';

    return;
  }

  updateDefaultCursor();
}

// Initialize cursor
function initCursor() {
  if (!document.body || !document.head) {
    requestAnimationFrame(initCursor);
    return;
  }
  setTimeout(updateCursor, 0);

  // Initialize cursor style element
  if (!cursorStyleEl) {
    cursorStyleEl = document.createElement('style');
    cursorStyleEl.id = 'custom-cursor-style';
    document.head.appendChild(cursorStyleEl);
  }

  // Add mousemove listener to handle cursor states and text glyph detection
  const onMouseMove = (e: MouseEvent) => {
    if (!getCustomCursorEnabled()) {
      if (cursorStyleEl) {
        cursorStyleEl.textContent = '';
      }
      const shadowStyleEls = getShadowRootStyleEl('[data-email-container]');
      for (const shadowStyleEl of shadowStyleEls) {
        shadowStyleEl.textContent = '';
      }
      currentCursorType = null;
      return;
    }


    const target = e.target as Element;
    if (target.shadowRoot) {
      // console.log(target.shadowRoot.querySelector('div'))
      target.shadowRoot.querySelector('div')?.addEventListener('mousemove', onMouseMove)
      return
    }
    // console.log({ target }, 'currentTarget', e.currentTarget)
    const isInEmailShadow = isInsideEmailShadowRoot(target);
    const targetComputedStyle = getComputedStyle(target)
    const computedCursor = targetComputedStyle.cursor;
    const computedUserSelect = targetComputedStyle.userSelect;

    // Extract fallback cursor if computed cursor is a custom cursor string
    const baseCursor = extractFallbackCursor(computedCursor);

    // If inside email shadow root, try to infer cursor from element tag
    let inferredCursorType: string | null = null;
    if (isInEmailShadow) {
      // inferredCursorType = inferCursorFromElement(target);
    }

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

    // Only update if cursor type changed
    if (cs === currentCursorType) return;

    // Get the cursor using getCursor() which handles white fill replacement
    const cursor = getCursor(cs);

    if (!cursorStyleEl) return;

    const cursorStyle = cursor ? `* { cursor: ${cursor} !important; }` : '';

    if (cursor) {
      cursorStyleEl.textContent = cursorStyle;
      const shadowStyleEls = getShadowRootStyleEl('[data-email-container]');
      for (const shadowStyleEl of shadowStyleEls) {
        shadowStyleEl.textContent = cursorStyle;
      }
      currentCursorType = cs;
    } else {
      cursorStyleEl.textContent = '';
      const shadowStyleEls = getShadowRootStyleEl('[data-email-container]');
      for (const shadowStyleEl of shadowStyleEls) {
        shadowStyleEl.textContent = '';
      }
      currentCursorType = null;
    }

  }
  document.addEventListener('mousemove', onMouseMove);

  // Clean up on mouseout
  document.addEventListener('mouseout', () => {
    if (cursorStyleEl) {
      cursorStyleEl.textContent = '';
    }
    const shadowStyleEls = getShadowRootStyleEl('[data-email-container]');
    for (const shadowStyleEl of shadowStyleEls) {
      shadowStyleEl.textContent = '';
    }
    currentCursorType = null;
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initCursor);
} else {
  initCursor();
}

// Watch for theme changes and preference changes
let lastAccentColor = '';
let lastCursorEnabled = getCustomCursorEnabled();
setInterval(() => {
  if (!document.body) return;
  const currentAccentColor = getComputedStyle(document.documentElement)
    .getPropertyValue('--color-accent')
    .trim();
  const currentCursorEnabled = getCustomCursorEnabled();

  if (
    (currentAccentColor && currentAccentColor !== lastAccentColor) ||
    currentCursorEnabled !== lastCursorEnabled
  ) {
    lastAccentColor = currentAccentColor;
    lastCursorEnabled = currentCursorEnabled;
    updateCursor();
    updateDefaultCursor();
  }
}, 100);

// Listen for immediate preference changes
window.addEventListener('cursor-preference-changed', () => {
  lastCursorEnabled = getCustomCursorEnabled();
  updateCursor();
  updateDefaultCursor();
});