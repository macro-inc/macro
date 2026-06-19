import { XMLParser } from 'fast-xml-parser';

/**
 * Manual XML serializer/deserializer for Lexical `SerializedEditorState`.
 *
 * Operates purely on the plain JSON object produced by
 * `editor.getEditorState().toJSON()` — no Lexical APIs are used. The matching
 * `xml-transformer.ts` implementation (written separately) must produce the
 * exact same XML format and pass the same test suite (`tests/xml.test.ts`).
 *
 * Format: one element per line, indented two spaces per depth. Every node
 * carries an `id` attribute sourced from `node.$.id`. Text format bitmasks are
 * decoded into named boolean attributes. Node types we don't explicitly model
 * fall back to an opaque `<unknown>` element carrying base64-encoded JSON so
 * they round-trip byte-for-byte.
 */

// ---------------------------------------------------------------------------
// Shared types (kept loose — these are plain JSON objects, not Lexical nodes)
// ---------------------------------------------------------------------------

type Json = any;

export interface SerializedEditorState {
  root: Json;
}

// Format bitmask -> attribute name. Order matters for stable output.
const FORMAT_FLAGS: Array<[number, string]> = [
  [1, 'bold'],
  [2, 'italic'],
  [4, 'strikethrough'],
  [8, 'underline'],
  [16, 'code'],
  [32, 'subscript'],
  [64, 'superscript'],
];

const SFS_URL_PREFIX = 'https://static-file-service.macro.com/file/';

// ---------------------------------------------------------------------------
// Escaping
// ---------------------------------------------------------------------------

function escapeText(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeAttr(s: string): string {
  return escapeText(s).replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
// toXml — walk the SerializedEditorState tree and emit indented XML lines
// ---------------------------------------------------------------------------

export function toXml(state: SerializedEditorState): string {
  const lines: string[] = [];
  emitRoot(state.root, lines);
  return lines.join('\n');
}

function attr(name: string, value: string | number | boolean): string {
  return ` ${name}="${escapeAttr(String(value))}"`;
}

function idAttr(node: Json): string {
  const id = node?.$?.id;
  return id != null ? attr('id', id) : '';
}

function indentStr(depth: number): string {
  return '  '.repeat(depth);
}

function emitRoot(root: Json, lines: string[]): void {
  const children: Json[] = root?.children ?? [];
  if (children.length === 0) {
    lines.push('<doc/>');
    return;
  }
  lines.push('<doc>');
  for (const child of children) emitNode(child, 1, lines);
  lines.push('</doc>');
}

function emitNode(node: Json, depth: number, lines: string[]): void {
  const pad = indentStr(depth);
  switch (node.type) {
    case 'text':
      return emitText(node, pad, lines);
    case 'linebreak':
      lines.push(`${pad}<br/>`);
      return;
    case 'paragraph':
      return emitContainer('p', node, depth, lines);
    case 'heading':
      // tag is h1/h2/h3 — used directly as the element name
      return emitContainer(node.tag ?? 'h1', node, depth, lines);
    case 'quote':
      return emitContainer('blockquote', node, depth, lines);
    case 'list':
      // tag is ul/ol
      return emitContainer(node.tag ?? 'ul', node, depth, lines);
    case 'listitem':
      return emitContainer('li', node, depth, lines);
    case 'table':
      return emitTable(node, depth, lines);
    case 'tablerow':
      return emitContainer('tr', node, depth, lines);
    case 'tablecell':
      return emitContainer('td', node, depth, lines);
    case 'link':
    case 'autolink':
      return emitLink(node, depth, lines);
    case 'date-mention':
      return emitDateMention(node, pad, lines);
    case 'user-mention':
      return emitUserMention(node, pad, lines);
    case 'document-mention':
      return emitDocMention(node, pad, lines);
    case 'equation':
      return emitEquation(node, pad, lines);
    case 'horizontalrule':
      lines.push(`${pad}<hr${idAttr(node)}/>`);
      return;
    case 'image':
      return emitImage(node, pad, lines);
    default:
      return emitUnknown(node, pad, lines);
  }
}

function emitText(node: Json, pad: string, lines: string[]): void {
  let attrs = idAttr(node);
  const format: number = node.format ?? 0;
  for (const [bit, name] of FORMAT_FLAGS) {
    if (format & bit) attrs += attr(name, true);
  }
  lines.push(`${pad}<t${attrs}>${escapeText(node.text ?? '')}</t>`);
}

function emitContainer(
  tag: string,
  node: Json,
  depth: number,
  lines: string[],
  extraAttrs = ''
): void {
  const pad = indentStr(depth);
  const children: Json[] = node.children ?? [];
  const open = `${tag}${idAttr(node)}${extraAttrs}`;
  if (children.length === 0) {
    lines.push(`${pad}<${open}/>`);
    return;
  }
  lines.push(`${pad}<${open}>`);
  for (const child of children) emitNode(child, depth + 1, lines);
  lines.push(`${pad}</${tag}>`);
}

function emitTable(node: Json, depth: number, lines: string[]): void {
  let extra = '';
  if (Array.isArray(node.colWidths)) {
    extra = attr('colWidths', node.colWidths.join(','));
  }
  emitContainer('table', node, depth, lines, extra);
}

function emitLink(node: Json, depth: number, lines: string[]): void {
  const extra = node.url != null ? attr('href', node.url) : '';
  emitContainer('a', node, depth, lines, extra);
}

function emitDateMention(node: Json, pad: string, lines: string[]): void {
  let attrs = idAttr(node);
  attrs += attr('date', node.date ?? '');
  attrs += attr('displayFormat', node.displayFormat ?? '');
  if (node.mentionUuid != null) attrs += attr('mentionUuid', node.mentionUuid);
  lines.push(`${pad}<date-mention${attrs}/>`);
}

function emitUserMention(node: Json, pad: string, lines: string[]): void {
  let attrs = idAttr(node);
  attrs += attr('userId', node.userId ?? '');
  attrs += attr('email', node.email ?? '');
  if (node.mentionUuid != null) attrs += attr('mentionUuid', node.mentionUuid);
  lines.push(`${pad}<user-mention${attrs}/>`);
}

function emitDocMention(node: Json, pad: string, lines: string[]): void {
  let attrs = idAttr(node);
  attrs += attr('documentId', node.documentId ?? '');
  attrs += attr('documentName', node.documentName ?? '');
  if (node.mentionUuid != null) attrs += attr('mentionUuid', node.mentionUuid);
  lines.push(`${pad}<doc-mention${attrs}/>`);
}

function emitEquation(node: Json, pad: string, lines: string[]): void {
  const inline = node.inline ? attr('inline', true) : attr('inline', false);
  lines.push(
    `${pad}<equation${idAttr(node)}${inline}>${escapeText(
      node.equation ?? ''
    )}</equation>`
  );
}

function emitImage(node: Json, pad: string, lines: string[]): void {
  let attrs = idAttr(node);
  attrs += attr('srcType', node.srcType ?? '');
  attrs += attr('fileId', node.id ?? '');
  attrs += attr('width', node.width ?? 0);
  attrs += attr('height', node.height ?? 0);
  attrs += attr('scale', node.scale ?? 1);
  attrs += attr('alt', node.alt ?? '');
  lines.push(`${pad}<image${attrs}/>`);
}

function emitUnknown(node: Json, pad: string, lines: string[]): void {
  const id = node?.$?.id;
  // The base64 payload carries the full node minus the fields surfaced as
  // attributes (type, id) so it round-trips losslessly.
  const { type, $, ...rest } = node;
  const payload = { ...rest } as Json;
  if ($ != null) {
    // preserve the rest of $ (everything except id, which becomes an attribute)
    const { id: _ignored, ...restMeta } = $;
    if (Object.keys(restMeta).length > 0) payload.$ = restMeta;
  }
  const data = base64Encode(JSON.stringify(payload));
  let attrs = attr('type', type ?? '');
  if (id != null) attrs += attr('id', id);
  attrs += attr('data', data);
  lines.push(`${pad}<unknown${attrs}/>`);
}

// ---------------------------------------------------------------------------
// fromXml — parse the XML back into a SerializedEditorState JSON object
// ---------------------------------------------------------------------------

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  // Preserve element ordering and allow repeated tags as arrays consistently.
  preserveOrder: true,
  // Keep text content verbatim; we handle our own escaping expectations.
  trimValues: false,
  parseAttributeValue: false,
  parseTagValue: false,
});

export function fromXml(xml: string): SerializedEditorState {
  const parsed = parser.parse(xml);
  // With preserveOrder, parsed is an array of nodes; find the <doc> root.
  const docEntry = findEntry(parsed, 'doc');
  if (!docEntry) {
    throw new Error('fromXml: missing <doc> root element');
  }

  const root: Json = {
    children: parseChildren(docEntry.doc),
    direction: 'ltr',
    format: '',
    indent: 0,
    type: 'root',
    version: 1,
    $: { documentMetadata: { version: 1.4, environmentTags: null }, id: 'root' },
  };

  return { root };
}

// preserveOrder entries look like: { tagName: [...children], ':@': { attrs } }
// or for text: { '#text': 'value' }

function findEntry(arr: Json[], tag: string): Json | undefined {
  return arr.find((e) => e[tag] !== undefined);
}

function getAttrs(entry: Json): Record<string, string> {
  const raw = entry[':@'] ?? {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (k.startsWith('@_')) out[k.slice(2)] = String(v);
  }
  return out;
}

function unescapeXml(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&');
}

function textContent(children: Json[]): string {
  if (!Array.isArray(children)) return '';
  let out = '';
  for (const c of children) {
    if (c['#text'] !== undefined) out += String(c['#text']);
  }
  return unescapeXml(out);
}

function idMeta(attrs: Record<string, string>): { $: Json } | {} {
  return attrs.id != null ? { $: { id: attrs.id } } : {};
}

function parseChildren(children: Json[]): Json[] {
  if (!Array.isArray(children)) return [];
  const out: Json[] = [];
  for (const entry of children) {
    // Skip stray top-level text (whitespace between elements).
    const tag = Object.keys(entry).find((k) => k !== ':@' && k !== '#text');
    if (!tag) continue;
    const parsed = parseElement(tag, entry);
    if (parsed) out.push(parsed);
  }
  return out;
}

function parseElement(tag: string, entry: Json): Json | null {
  const attrs = getAttrs(entry);
  const inner: Json[] = entry[tag] ?? [];

  switch (tag) {
    case 't':
      return parseText(attrs, inner);
    case 'br':
      return { type: 'linebreak', version: 1 };
    case 'p':
      return container('paragraph', attrs, inner, {
        direction: 'ltr',
        format: '',
        indent: 0,
        textFormat: 0,
        textStyle: '',
        version: 1,
      });
    case 'h1':
    case 'h2':
    case 'h3':
      return container(
        'heading',
        attrs,
        inner,
        { direction: 'ltr', format: '', indent: 0, version: 1 },
        { tag }
      );
    case 'blockquote':
      return container('quote', attrs, inner, {
        direction: 'ltr',
        format: '',
        indent: 0,
        version: 1,
      });
    case 'ul':
    case 'ol':
      return container(
        'list',
        attrs,
        inner,
        { direction: 'ltr', format: '', indent: 0, start: 1, version: 1 },
        {
          listType: tag === 'ol' ? 'number' : 'bullet',
          start: 1,
          tag,
        }
      );
    case 'li':
      return container('listitem', attrs, inner, {
        direction: 'ltr',
        format: '',
        indent: 0,
        value: 1,
        version: 1,
      });
    case 'table':
      return parseTable(attrs, inner);
    case 'tr':
      return container('tablerow', attrs, inner, {
        direction: 'ltr',
        format: '',
        indent: 0,
        version: 1,
      });
    case 'td':
      return container('tablecell', attrs, inner, {
        direction: 'ltr',
        format: '',
        indent: 0,
        version: 1,
        backgroundColor: null,
        colSpan: 1,
        headerState: 0,
        rowSpan: 1,
      });
    case 'a':
      return parseLink(attrs, inner);
    case 'date-mention':
      return parseDateMention(attrs);
    case 'user-mention':
      return parseUserMention(attrs);
    case 'doc-mention':
      return parseDocMention(attrs);
    case 'equation':
      return parseEquation(attrs, inner);
    case 'hr':
      return { type: 'horizontalrule', version: 1, ...idMeta(attrs) };
    case 'image':
      return parseImage(attrs);
    case 'unknown':
      return parseUnknown(attrs);
    default:
      // Unrecognized element name: treat as unknown opaque if it carries data.
      if (attrs.data != null) return parseUnknown(attrs);
      return null;
  }
}

function parseText(attrs: Record<string, string>, inner: Json[]): Json {
  let format = 0;
  for (const [bit, name] of FORMAT_FLAGS) {
    if (attrs[name] === 'true') format |= bit;
  }
  return {
    detail: 0,
    format,
    mode: 'normal',
    style: '',
    text: textContent(inner),
    type: 'text',
    version: 1,
    ...idMeta(attrs),
  };
}

function container(
  type: string,
  attrs: Record<string, string>,
  inner: Json[],
  constants: Json,
  extra: Json = {}
): Json {
  return {
    children: parseChildren(inner),
    ...constants,
    type,
    ...extra,
    ...idMeta(attrs),
  };
}

function parseTable(attrs: Record<string, string>, inner: Json[]): Json {
  const node: Json = {
    children: parseChildren(inner),
    direction: 'ltr',
    format: '',
    indent: 0,
    type: 'table',
    version: 1,
    ...idMeta(attrs),
  };
  if (attrs.colWidths != null && attrs.colWidths !== '') {
    node.colWidths = attrs.colWidths.split(',').map((w) => Number(w));
  }
  return node;
}

function parseLink(attrs: Record<string, string>, inner: Json[]): Json {
  return {
    children: parseChildren(inner),
    direction: 'ltr',
    format: '',
    indent: 0,
    type: 'link',
    version: 1,
    rel: null,
    target: null,
    title: null,
    url: attrs.href ?? '',
    ...idMeta(attrs),
  };
}

function parseDateMention(attrs: Record<string, string>): Json {
  const node: Json = {
    type: 'date-mention',
    version: 1,
    ...idMeta(attrs),
    date: attrs.date ?? '',
    displayFormat: attrs.displayFormat ?? '',
  };
  if (attrs.mentionUuid != null) node.mentionUuid = attrs.mentionUuid;
  return node;
}

function parseUserMention(attrs: Record<string, string>): Json {
  const node: Json = {
    type: 'user-mention',
    version: 1,
    ...idMeta(attrs),
    userId: attrs.userId ?? '',
    email: attrs.email ?? '',
  };
  if (attrs.mentionUuid != null) node.mentionUuid = attrs.mentionUuid;
  return node;
}

function parseDocMention(attrs: Record<string, string>): Json {
  const node: Json = {
    type: 'document-mention',
    version: 2,
    ...idMeta(attrs),
    documentId: attrs.documentId ?? '',
    documentName: attrs.documentName ?? '',
  };
  if (attrs.mentionUuid != null) node.mentionUuid = attrs.mentionUuid;
  return node;
}

function parseEquation(attrs: Record<string, string>, inner: Json[]): Json {
  return {
    type: 'equation',
    version: 1,
    ...idMeta(attrs),
    equation: textContent(inner),
    inline: attrs.inline === 'true',
  };
}

function parseImage(attrs: Record<string, string>): Json {
  const srcType = attrs.srcType ?? '';
  const fileId = attrs.fileId ?? '';
  // For sfs-hosted images the url is deterministic from the file id.
  const url = srcType === 'sfs' ? `${SFS_URL_PREFIX}${fileId}` : '';
  return {
    type: 'image',
    version: 1,
    ...idMeta(attrs),
    srcType,
    id: fileId,
    url,
    width: Number(attrs.width ?? 0),
    height: Number(attrs.height ?? 0),
    scale: Number(attrs.scale ?? 1),
    alt: attrs.alt ?? '',
  };
}

function parseUnknown(attrs: Record<string, string>): Json {
  const payload = JSON.parse(base64Decode(attrs.data ?? 'e30=')); // e30= == {}
  const node: Json = { type: attrs.type, ...payload };
  if (attrs.id != null) {
    node.$ = { ...(payload.$ ?? {}), id: attrs.id };
  }
  return node;
}

// ---------------------------------------------------------------------------
// base64 helpers (work in both Bun/Node and browser-ish environments)
// ---------------------------------------------------------------------------

function base64Encode(s: string): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(s, 'utf-8').toString('base64');
  }
  // eslint-disable-next-line no-undef
  return btoa(unescape(encodeURIComponent(s)));
}

function base64Decode(s: string): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(s, 'base64').toString('utf-8');
  }
  // eslint-disable-next-line no-undef
  return decodeURIComponent(escape(atob(s)));
}
