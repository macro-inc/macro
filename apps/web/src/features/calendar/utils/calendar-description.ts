import { editorIsEmpty } from '@core/component/LexicalMarkdown/utils';
import { convertBookingLinkMentionsToLinks } from '@core/component/LexicalMarkdown/utils/convertBookingLinkMentionsToLinks';
import { convertDocumentMentionsToLinks } from '@core/component/LexicalMarkdown/utils/convertDocumentMentionsToLinks';
import { getWebOrigin } from '@core/util/webOrigin';
import { $generateHtmlFromNodes } from '@lexical/html';
import type { LexicalEditor } from 'lexical';

import {
  sanitizeCalendarDescription,
  sanitizeDocument,
} from './calendar-description-sanitizer';

export { sanitizeCalendarDescription } from './calendar-description-sanitizer';

function parseHtml(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
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
 * The description as plain text, as an `.ics` export carries it: one line per
 * paragraph, line break and list item, and a link's address after its text
 * when the text does not already show it.
 */
export function calendarDescriptionText(raw: string): string {
  const safe = sanitizeCalendarDescription(raw);
  if (!safe) return '';
  const doc = parseHtml(safe);
  for (const anchor of doc.body.querySelectorAll('a[href]')) {
    const href = anchor.getAttribute('href') ?? '';
    const text = anchor.textContent?.trim() ?? '';
    if (text !== href) anchor.append(text ? ` (${href})` : href);
  }
  for (const lineBreak of doc.body.querySelectorAll('br')) {
    lineBreak.replaceWith('\n');
  }
  for (const item of doc.body.querySelectorAll('li')) item.prepend('- ');
  for (const block of doc.body.querySelectorAll('p, li')) block.append('\n');
  return (doc.body.textContent ?? '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
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
  convertBookingLinkMentionsToLinks(doc.body);
  sanitizeDocument(doc, false);
  return doc.body.innerHTML;
}
