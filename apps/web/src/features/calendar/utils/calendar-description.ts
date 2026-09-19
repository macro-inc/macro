import { editorIsEmpty } from '@core/component/LexicalMarkdown/utils';
import { convertDocumentMentionsToLinks } from '@core/component/LexicalMarkdown/utils/convertDocumentMentionsToLinks';
import { getWebOrigin } from '@core/util/webOrigin';
import { $generateHtmlFromNodes } from '@lexical/html';
import type { LexicalEditor } from 'lexical';

/**
 * Formatting a description keeps across the provider boundary. Anything the
 * editor or a provider adds beyond this — classes, inline styles, mention
 * data attributes, media, scripts — is dropped, so the stored string is
 * portable HTML that carries no reader or author identities.
 */
const KEPT_TAGS = new Set([
  'p',
  'br',
  'a',
  'b',
  'strong',
  'i',
  'em',
  'u',
  's',
  'ul',
  'ol',
  'li',
]);
const INLINE_TAGS = new Set(['a', 'b', 'strong', 'i', 'em', 'u', 's', 'br']);
const LIST_TAGS = new Set(['ul', 'ol']);
/** Containers whose line structure is worth keeping as a paragraph. */
const PARAGRAPH_LIKE_TAGS = new Set([
  'div',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'pre',
  'blockquote',
  'address',
  'section',
  'article',
  'header',
  'footer',
  'figure',
  'figcaption',
  'tr',
  'dt',
  'dd',
  'summary',
  'details',
]);
/** Removed together with their content. */
const DROPPED_TAGS = new Set([
  'script',
  'style',
  'iframe',
  'frame',
  'frameset',
  'object',
  'embed',
  'applet',
  'base',
  'meta',
  'link',
  'noscript',
  'template',
  'svg',
  'math',
  'head',
  'title',
  'textarea',
  'select',
  'option',
  'input',
  'button',
  'form',
  'img',
  'picture',
  'source',
  'video',
  'audio',
  'canvas',
]);
const LINK_SCHEMES = new Set(['http:', 'https:', 'mailto:', 'tel:']);

/**
 * A tag a description would only contain if it were authored as HTML. Plain
 * text legitimately holds angle brackets — `<bob@example.com>`, `<TBD>` — so
 * "looks like a tag" is not enough to treat the whole string as markup.
 */
const HTML_TAG_PATTERN =
  /<(?:!--|\/?(?:a|abbr|b|big|blockquote|body|br|center|cite|code|dd|del|details|div|dl|dt|em|figure|font|h[1-6]|head|hr|html|i|iframe|img|ins|li|link|meta|ol|p|pre|s|script|section|small|span|strike|strong|style|sub|summary|sup|table|tbody|td|template|tfoot|th|thead|title|tr|tt|u|ul)(?=[\s/>]))/i;

function parseHtml(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

/**
 * Plain text is still parsed as HTML so provider-escaped entities decode, but
 * its angle brackets are literal characters, never tags.
 */
function parsePlainText(text: string): Document {
  return parseHtml(text.replace(/</g, '&lt;').replace(/>/g, '&gt;'));
}

function safeHref(value: string | null): string | undefined {
  if (!value) return undefined;
  // Browsers tolerate whitespace and control characters inside a scheme
  // ("java\nscript:"), so strip them before parsing.
  const compact = Array.from(value)
    .filter((char) => char.charCodeAt(0) > 0x20)
    .join('');
  try {
    const url = new URL(compact);
    return LINK_SCHEMES.has(url.protocol) ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function unwrap(element: Element) {
  element.replaceWith(...Array.from(element.childNodes));
}

function isBlock(node: Node): boolean {
  return (
    node.nodeType === Node.ELEMENT_NODE &&
    !INLINE_TAGS.has((node as Element).localName)
  );
}

/** A paragraph left with nothing in it. `<p><br></p>` is a deliberate blank line and stays. */
function isEmptyParagraph(element: Element): boolean {
  return (
    element.localName === 'p' &&
    element.firstElementChild === null &&
    (element.textContent ?? '').trim() === ''
  );
}

function replaceWithParagraph(element: Element) {
  const paragraph = element.ownerDocument.createElement('p');
  paragraph.append(...Array.from(element.childNodes));
  if (isEmptyParagraph(paragraph)) {
    element.remove();
    return;
  }
  element.replaceWith(paragraph);
}

/** Convert newlines in text nodes to `<br>` for descriptions stored as plain text. */
function breakLines(parent: Node) {
  const doc = parent.ownerDocument;
  if (!doc) return;
  const walker = doc.createTreeWalker(parent, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if ((node.textContent ?? '').includes('\n')) textNodes.push(node as Text);
  }
  for (const textNode of textNodes) {
    const lines = (textNode.textContent ?? '').split('\n');
    const replacement: Node[] = [];
    lines.forEach((line, index) => {
      if (index > 0) replacement.push(doc.createElement('br'));
      if (line) replacement.push(doc.createTextNode(line));
    });
    textNode.replaceWith(...replacement);
  }
}

/** Lists may only hold list items, and list items only live inside lists. */
function normalizeList(list: Element) {
  const doc = list.ownerDocument;
  let orphanItem: Element | undefined;
  for (const child of Array.from(list.childNodes)) {
    if (child.nodeType === Node.ELEMENT_NODE) {
      const element = child as Element;
      if (element.localName === 'li') {
        orphanItem = undefined;
        continue;
      }
      if (LIST_TAGS.has(element.localName)) {
        // A nested list belongs to the preceding item.
        const previous = element.previousElementSibling;
        if (previous?.localName === 'li') {
          previous.appendChild(element);
          continue;
        }
      }
    } else if ((child.textContent ?? '').trim() === '') {
      child.remove();
      continue;
    }
    if (!orphanItem) {
      orphanItem = doc.createElement('li');
      list.insertBefore(orphanItem, child);
    }
    orphanItem.appendChild(child);
  }
}

function sanitizeChildren(parent: Element) {
  for (const child of Array.from(parent.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) continue;
    if (child.nodeType !== Node.ELEMENT_NODE) {
      child.remove();
      continue;
    }
    const element = child as Element;
    const tag = element.localName;
    if (DROPPED_TAGS.has(tag)) {
      element.remove();
      continue;
    }
    sanitizeChildren(element);

    if (KEPT_TAGS.has(tag)) {
      const href = tag === 'a' ? safeHref(element.getAttribute('href')) : null;
      for (const name of element.getAttributeNames()) {
        element.removeAttribute(name);
      }
      if (tag === 'a') {
        if (!href) {
          unwrap(element);
          continue;
        }
        element.setAttribute('href', href);
      }
      if (tag === 'li' && !LIST_TAGS.has(parent.localName)) {
        replaceWithParagraph(element);
        continue;
      }
      if (tag === 'p' && isEmptyParagraph(element)) {
        element.remove();
        continue;
      }
      if (LIST_TAGS.has(tag)) normalizeList(element);
      continue;
    }

    if (
      PARAGRAPH_LIKE_TAGS.has(tag) &&
      !Array.from(element.childNodes).some(isBlock)
    ) {
      replaceWithParagraph(element);
      continue;
    }
    unwrap(element);
  }
}

/** Gather top-level runs of text and inline elements into paragraphs. */
function wrapInlineRuns(parent: Element) {
  const doc = parent.ownerDocument;
  let run: Node[] = [];
  const flush = () => {
    if (run.length === 0) return;
    const hasContent = run.some((node) =>
      node.nodeType === Node.ELEMENT_NODE
        ? (node as Element).localName !== 'br'
        : (node.textContent ?? '').trim() !== ''
    );
    if (hasContent) {
      const paragraph = doc.createElement('p');
      parent.insertBefore(paragraph, run[0]);
      paragraph.append(...run);
    } else {
      for (const node of run) node.parentNode?.removeChild(node);
    }
    run = [];
  };
  for (const child of Array.from(parent.childNodes)) {
    if (isBlock(child)) {
      flush();
      continue;
    }
    run.push(child);
  }
  flush();
}

function sanitizeDocument(doc: Document, plainText: boolean) {
  if (plainText) breakLines(doc.body);
  sanitizeChildren(doc.body);
  wrapInlineRuns(doc.body);
}

/**
 * Reduce a stored description — provider text, provider HTML, or this
 * editor's own output — to the portable subset. A description without any
 * HTML tag is plain text: its angle brackets are kept as text and its line
 * breaks become `<br>`.
 *
 * Safe to render with `innerHTML`: active elements, event handlers, and
 * non-http(s)/mailto/tel links never survive.
 */
export function sanitizeCalendarDescription(raw: string): string {
  if (raw.trim() === '') return '';
  const plainText = !HTML_TAG_PATTERN.test(raw);
  const doc = plainText ? parsePlainText(raw) : parseHtml(raw);
  sanitizeDocument(doc, plainText);
  return doc.body.innerHTML;
}

const APP_LINK_PATTERN = /^\/app\/([a-z0-9_-]+)\/([A-Za-z0-9_-]+)\/?$/i;

/** Which Macro entity an `/app/<block>/<id>` link opens, if it is one. */
export function parseMacroAppLink(
  href: string
): { blockName: string; documentId: string } | undefined {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return undefined;
  }
  const origins = new Set([
    window.location.origin,
    getWebOrigin(),
    'https://macro.com',
  ]);
  if (!origins.has(url.origin)) return undefined;
  const match = APP_LINK_PATTERN.exec(url.pathname);
  if (!match) return undefined;
  return { blockName: match[1], documentId: match[2] };
}

/**
 * The HTML to seed the description editor with. Links to Macro entities are
 * marked so the editor rehydrates them as mention pills.
 */
export function calendarDescriptionToEditorHtml(raw: string): string {
  const safe = sanitizeCalendarDescription(raw);
  if (!safe) return '';
  const doc = parseHtml(safe);
  for (const anchor of doc.body.querySelectorAll('a[href]')) {
    const target = parseMacroAppLink(anchor.getAttribute('href') ?? '');
    if (!target) continue;
    anchor.setAttribute('data-document-mention', 'true');
    anchor.setAttribute('data-document-id', target.documentId);
    anchor.setAttribute('data-block-name', target.blockName);
    anchor.setAttribute('data-document-name', anchor.textContent ?? '');
  }
  return doc.body.innerHTML;
}

/**
 * The description to store for the editor's current content. Document
 * mentions become plain Macro links, every other mention keeps only its
 * display text, and an empty editor is an empty description.
 */
export function exportCalendarDescription(editor: LexicalEditor): string {
  if (editorIsEmpty(editor)) return '';
  const doc = parseHtml(editor.read(() => $generateHtmlFromNodes(editor)));
  convertDocumentMentionsToLinks(doc.body);
  sanitizeDocument(doc, false);
  return doc.body.innerHTML;
}
