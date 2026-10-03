import type { DocxEditorExports } from 'docxodus';

/**
 * Bridge calls that read the session without changing it. Everything else is
 * treated as a mutation, so a Docxodus release that adds an editing command is
 * published conservatively instead of silently dropped.
 */
const READ_ONLY_CALLS = new Set([
  'CloseSession',
  'CreateBlankDocx',
  'GetDiff',
  'GetEditSummary',
  'GetFormatting',
  'GetImageCapabilities',
  'GetListMembership',
  'GetSectionInfo',
  'GetVersion',
  'Grep',
  'GrepCrossBlock',
  'ListAnchors',
  'ListBlocks',
  'ListBookmarks',
  'ListComments',
  'ListContentControls',
  'ListHyperlinks',
  'ListImages',
  'ListInlineSpans',
  'ListNotes',
  'ListRenderedBlocks',
  'ListRevisions',
  'ListStyles',
  'OpenSession',
  'Project',
  'RawGetXml',
  'RemainingPlaceholders',
  'Save',
  'SaveWithAnchorIds',
  'ValidMoveTargets',
]);

const isRead = (name: string) =>
  READ_ONLY_CALLS.has(name) ||
  name.startsWith('Render') ||
  name.startsWith('Find');

/** Whole-document renders whose stylesheet must be scoped to the editor. */
const DOCUMENT_RENDERS = [
  'RenderHtml',
  'RenderHtmlForReview',
  'RenderEditorHtml',
] as const;

export type EditorBridgeOptions = {
  /** Selector of the editor's mount; document CSS is confined to it. */
  rootSelector: string;
  /** Settings merged into every session the editor opens. */
  sessionSettings: Record<string, unknown>;
  /** Called after every bridge call that may have changed the session. */
  onMutation: (call: string) => void;
};

type AnyFunction = (...args: never[]) => unknown;

/**
 * The editor's view of the engine: every session is opened with the sync
 * settings, document styles are scoped so the converter's `body`/`span` rules
 * cannot restyle the app, and mutations are reported for publishing.
 */
export function editorBridge(
  exports: DocxEditorExports,
  options: EditorBridgeOptions
): DocxEditorExports {
  const source = exports.DocxSessionBridge as unknown as Record<
    string,
    unknown
  >;
  const bridge: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(source)) {
    if (typeof value !== 'function') {
      bridge[name] = value;
      continue;
    }
    const call = value as AnyFunction;
    if (name === 'OpenSession') {
      bridge[name] = (bytes: Uint8Array, settingsJson: string) => {
        const requested = settingsJson
          ? (JSON.parse(settingsJson) as object)
          : {};
        return (call as (b: Uint8Array, s: string) => number)(
          bytes,
          JSON.stringify({ ...requested, ...options.sessionSettings })
        );
      };
    } else if ((DOCUMENT_RENDERS as readonly string[]).includes(name)) {
      bridge[name] = (...args: never[]) =>
        scopeDocumentStyles(call(...args) as string, options.rootSelector);
    } else if (isRead(name)) {
      bridge[name] = call;
    } else {
      bridge[name] = (...args: never[]) => {
        const result = call(...args);
        options.onMutation(name);
        return result;
      };
    }
  }
  const convert = exports.DocumentConverter.ConvertDocxToHtmlComplete;
  return {
    DocxSessionBridge: bridge as DocxEditorExports['DocxSessionBridge'],
    DocumentConverter: {
      ConvertDocxToHtmlComplete: (...args: unknown[]) =>
        scopeDocumentStyles(convert(...args), options.rootSelector),
    },
  };
}

const SCOPED_ATTRIBUTE = 'data-macro-docx-scoped';

function splitSelectors(selectorText: string): string[] {
  const selectors: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < selectorText.length; i++) {
    const char = selectorText[i];
    if (char === '(' || char === '[') depth++;
    else if (char === ')' || char === ']') depth--;
    else if (char === ',' && depth === 0) {
      selectors.push(selectorText.slice(start, i).trim());
      start = i + 1;
    }
  }
  selectors.push(selectorText.slice(start).trim());
  return selectors.filter(Boolean);
}

/** Re-root one selector: the document's `html`/`body`/`:root` become the mount. */
export function scopeSelector(selector: string, root: string): string {
  let rest = selector.trim();
  let consumed = false;
  let separated = false;
  for (;;) {
    const match = /^(?:html|body|:root)(?=$|[\s>+~.#[:])/.exec(rest);
    if (!match) break;
    consumed = true;
    rest = rest.slice(match[0].length);
    const space = /^\s+/.exec(rest);
    separated = !!space;
    if (!space) break;
    rest = rest.slice(space[0].length);
  }
  if (!consumed) return `${root} ${rest}`;
  if (!rest) return root;
  if (separated || /^[>+~]/.test(rest)) return `${root} ${rest}`;
  return `${root}${rest}`;
}

function scopeRules(container: CSSStyleSheet | CSSGroupingRule, root: string) {
  for (let i = container.cssRules.length - 1; i >= 0; i--) {
    const rule = container.cssRules[i];
    // @page and @import cannot be confined to an element; drop them.
    if (rule instanceof CSSPageRule || rule instanceof CSSImportRule) {
      container.deleteRule(i);
    } else if (rule instanceof CSSStyleRule) {
      rule.selectorText = splitSelectors(rule.selectorText)
        .map((selector) => scopeSelector(selector, root))
        .join(', ');
    } else if ('cssRules' in rule) {
      scopeRules(rule as CSSGroupingRule, root);
    }
  }
}

function scopeStyle(style: HTMLStyleElement, root: string) {
  if (style.hasAttribute(SCOPED_ATTRIBUTE)) return;
  // Parse with the browser's CSSOM in an inert sheet, then write it back.
  const parser = document.createElement('style');
  parser.media = 'not all';
  parser.textContent = style.textContent ?? '';
  document.head.appendChild(parser);
  try {
    const sheet = parser.sheet;
    if (!sheet) return;
    scopeRules(sheet, root);
    style.textContent = Array.from(sheet.cssRules, (rule) => rule.cssText).join(
      '\n'
    );
    style.setAttribute(SCOPED_ATTRIBUTE, '');
  } finally {
    parser.remove();
  }
}

function scopeDocumentStyles(html: string, root: string): string {
  if (!html || html.charCodeAt(0) === 0x7b /* error object */) return html;
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  for (const style of Array.from(parsed.querySelectorAll('style')))
    scopeStyle(style, root);
  return `<!doctype html>\n${parsed.documentElement.outerHTML}`;
}
