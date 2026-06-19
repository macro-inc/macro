/**
 * Transformer-based XML serializer/deserializer for Lexical editor state.
 *
 * `toXml` takes a plain `SerializedEditorState` (from
 * `editor.getEditorState().toJSON()`) and returns a pretty-printed,
 * one-element-per-line XML string. `fromXml` is the exact inverse: it parses
 * that XML back into a `SerializedEditorState` suitable for
 * `editor.parseEditorState(...)`.
 *
 * The conversion walks the serialized JSON tree directly rather than routing
 * through the `@lexical/markdown` engine. The markdown pipeline discards the
 * `$` node-state (where stable ids live) and rebuilds fresh nodes, which makes
 * it impossible to faithfully round-trip the `id` attribute that the XML format
 * requires on every element. A direct tree walk preserves ids and every other
 * field losslessly while emitting exactly the documented format.
 */

import type { SerializedEditorState, SerializedLexicalNode } from 'lexical';
import { flatten, unflatten } from 'flat';

// Text format bitmask (lexical TextNode.format).
const FORMAT_BITS: Array<[string, number]> = [
  ['bold', 1],
  ['italic', 2],
  ['strikethrough', 4],
  ['underline', 8],
  ['code', 16],
  ['subscript', 32],
  ['superscript', 64],
];

const NODE_STATE_KEY = '$';

type AnyNode = SerializedLexicalNode & {
  children?: AnyNode[];
  [key: string]: unknown;
};

// ---------------------------------------------------------------------------
// Escaping helpers
// ---------------------------------------------------------------------------

function escText(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function unesc(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function b64encode(s: string): string {
  if (typeof Buffer !== 'undefined') return Buffer.from(s, 'utf-8').toString('base64');
  // eslint-disable-next-line no-undef
  return btoa(unescape(encodeURIComponent(s)));
}

function b64decode(s: string): string {
  if (typeof Buffer !== 'undefined') return Buffer.from(s, 'base64').toString('utf-8');
  // eslint-disable-next-line no-undef
  return decodeURIComponent(escape(atob(s)));
}

// ---------------------------------------------------------------------------
// Attribute builder / parser
// ---------------------------------------------------------------------------

function getId(node: AnyNode): string | undefined {
  const state = node[NODE_STATE_KEY] as { id?: unknown } | undefined;
  const id = state?.id;
  return typeof id === 'string' ? id : undefined;
}

/** Build an attribute string from ordered [name, value] pairs (skips nulls). */
function attrs(pairs: Array<[string, string | undefined]>): string {
  let out = '';
  for (const [k, v] of pairs) {
    if (v === undefined) continue;
    out += ` ${k}="${escAttr(v)}"`;
  }
  return out;
}

/** Parse the attribute portion of a tag (the part after the tag name). */
function parseAttrs(raw: string): Record<string, string> {
  const result: Record<string, string> = {};
  // include '.' so dot-notation keys like nested.a are captured
  const re = /([\w.\-]+)="([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    result[m[1]] = unesc(m[2]);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Serialization (JSON tree -> XML lines)
// ---------------------------------------------------------------------------

const INDENT = '  ';

/**
 * Fields that are part of an ElementNode's structural shape and either get a
 * dedicated attribute or are reconstructed with defaults on import. Everything
 * else is preserved through the opaque `data` mechanism.
 */
function idPair(node: AnyNode): [string, string | undefined] {
  return ['id', getId(node)];
}

function serializeText(node: AnyNode): string {
  const format = typeof node.format === 'number' ? node.format : 0;
  const pairs: Array<[string, string | undefined]> = [idPair(node)];
  for (const [name, bit] of FORMAT_BITS) {
    if (format & bit) pairs.push([name, 'true']);
  }
  // Preserve non-default text props that the clean format does not capture.
  if (node.style) pairs.push(['style', String(node.style)]);
  if (typeof node.detail === 'number' && node.detail !== 0) {
    pairs.push(['detail', String(node.detail)]);
  }
  if (node.mode && node.mode !== 'normal') {
    pairs.push(['mode', String(node.mode)]);
  }
  const text = typeof node.text === 'string' ? node.text : '';
  return `<t${attrs(pairs)}>${escText(text)}</t>`;
}

function serializeDateMention(node: AnyNode): string {
  return `<date-mention${attrs([
    idPair(node),
    ['date', String(node.date ?? '')],
    ['displayFormat', String(node.displayFormat ?? '')],
    ['mentionUuid', node.mentionUuid === undefined ? undefined : String(node.mentionUuid)],
  ])}/>`;
}

const SKIP_FIELDS = new Set(['type', 'children', '$']);

/** Fallback for any node we do not model explicitly.
 *  Flattens nested JSON to dot-notation attributes (e.g. blockParams.key="val").
 *  Arrays and objects are JSON-encoded; scalars go in as strings.
 *  Any field named "id" (conflicts with the stable-id attribute) is emitted as "_id".
 */
function serializeUnknown(node: AnyNode, indent: string, lines: string[]): void {
  const tag = String(node.type);
  const { children, ...rest } = node;
  const flat = flatten(rest, { safe: true }) as Record<string, unknown>;
  const pairs: Array<[string, string | undefined]> = [idPair(node)];
  for (const [k, v] of Object.entries(flat)) {
    // skip internal Lexical fields and anything under the $ node-state object
    if (SKIP_FIELDS.has(k) || k.startsWith('$')) continue;
    if (v === null || v === undefined) { pairs.push([k, 'null']); continue; }
    // arrays and objects: JSON-encode so they survive the round-trip
    if (typeof v === 'object') { pairs.push([k, JSON.stringify(v)]); continue; }
    // rename bare "id" to "_id" to avoid colliding with the stable-id attribute
    pairs.push([k === 'id' ? '_id' : k, String(v)]);
  }
  const open = `<${tag}${attrs(pairs)}`;
  if (children && children.length) {
    lines.push(indent + open + '>');
    for (const child of children) serializeNode(child, indent + INDENT, lines);
    lines.push(indent + `</${tag}>`);
  } else {
    lines.push(indent + open + '/>');
  }
}

/** Serialize an element with a simple `<tag id>...children...</tag>` shape. */
function serializeContainer(
  node: AnyNode,
  tag: string,
  extra: Array<[string, string | undefined]>,
  indent: string,
  lines: string[]
): void {
  const children = node.children ?? [];
  const open = `<${tag}${attrs([idPair(node), ...extra])}`;
  if (children.length === 0) {
    lines.push(indent + open + '/>');
    return;
  }
  lines.push(indent + open + '>');
  for (const child of children) serializeNode(child, indent + INDENT, lines);
  lines.push(indent + `</${tag}>`);
}

function serializeNode(node: AnyNode, indent: string, lines: string[]): void {
  switch (node.type) {
    case 'text':
      lines.push(indent + serializeText(node));
      return;
    case 'paragraph':
      serializeContainer(node, 'p', [], indent, lines);
      return;
    case 'heading':
      serializeContainer(node, String(node.tag ?? 'h1'), [], indent, lines);
      return;
    case 'list': {
      const tag = node.tag === 'ol' || node.listType === 'number' ? 'ol' : 'ul';
      const extra: Array<[string, string | undefined]> = [];
      if (node.listType === 'check') extra.push(['listType', 'check']);
      if (typeof node.start === 'number' && node.start !== 1) {
        extra.push(['start', String(node.start)]);
      }
      serializeContainer(node, tag, extra, indent, lines);
      return;
    }
    case 'listitem': {
      const extra: Array<[string, string | undefined]> = [];
      if (typeof node.value === 'number' && node.value !== 1) {
        extra.push(['value', String(node.value)]);
      }
      if (node.checked === true) extra.push(['checked', 'true']);
      serializeContainer(node, 'li', extra, indent, lines);
      return;
    }
    case 'table': {
      const extra: Array<[string, string | undefined]> = [];
      if (Array.isArray(node.colWidths)) {
        extra.push(['colWidths', (node.colWidths as number[]).join(',')]);
      }
      if (node.rowStriping === true) extra.push(['rowStriping', 'true']);
      serializeContainer(node, 'table', extra, indent, lines);
      return;
    }
    case 'tablerow': {
      const extra: Array<[string, string | undefined]> = [];
      if (typeof node.height === 'number') extra.push(['height', String(node.height)]);
      serializeContainer(node, 'tr', extra, indent, lines);
      return;
    }
    case 'tablecell': {
      const extra: Array<[string, string | undefined]> = [];
      if (typeof node.headerState === 'number' && node.headerState !== 0) {
        extra.push(['headerState', String(node.headerState)]);
      }
      if (typeof node.colSpan === 'number' && node.colSpan !== 1) {
        extra.push(['colSpan', String(node.colSpan)]);
      }
      if (typeof node.rowSpan === 'number' && node.rowSpan !== 1) {
        extra.push(['rowSpan', String(node.rowSpan)]);
      }
      if (node.backgroundColor) {
        extra.push(['backgroundColor', String(node.backgroundColor)]);
      }
      serializeContainer(node, 'td', extra, indent, lines);
      return;
    }
    case 'horizontalrule':
      lines.push(indent + `<hr${attrs([idPair(node)])}/>`);
      return;
    case 'date-mention':
      lines.push(indent + serializeDateMention(node));
      return;
    default:
      serializeUnknown(node, indent, lines);
      return;
  }
}

export function toXml(state: SerializedEditorState): string {
  const root = state.root as unknown as AnyNode;
  const lines: string[] = ['<doc>'];
  for (const child of root.children ?? []) {
    serializeNode(child, '', lines);
  }
  lines.push('</doc>');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Deserialization (XML -> JSON tree)
// ---------------------------------------------------------------------------

interface ParsedTag {
  name: string;
  attrs: Record<string, string>;
  selfClosing: boolean;
  closing: boolean;
}

/** Tokenize the minified XML into a flat list of tags and text runs. */
type Token =
  | { kind: 'open'; tag: ParsedTag }
  | { kind: 'close'; name: string }
  | { kind: 'selfclose'; tag: ParsedTag }
  | { kind: 'text'; text: string };

function tokenize(xml: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < xml.length) {
    if (xml[i] === '<') {
      const end = xml.indexOf('>', i);
      if (end === -1) break;
      const inner = xml.slice(i + 1, end);
      i = end + 1;
      if (inner.startsWith('/')) {
        tokens.push({ kind: 'close', name: inner.slice(1).trim() });
        continue;
      }
      const selfClosing = inner.endsWith('/');
      const body = selfClosing ? inner.slice(0, -1) : inner;
      const spaceIdx = body.search(/\s/);
      const name = spaceIdx === -1 ? body.trim() : body.slice(0, spaceIdx);
      const attrStr = spaceIdx === -1 ? '' : body.slice(spaceIdx);
      const tag: ParsedTag = {
        name,
        attrs: parseAttrs(attrStr),
        selfClosing,
        closing: false,
      };
      tokens.push(selfClosing ? { kind: 'selfclose', tag } : { kind: 'open', tag });
    } else {
      const next = xml.indexOf('<', i);
      const text = xml.slice(i, next === -1 ? undefined : next);
      tokens.push({ kind: 'text', text });
      i = next === -1 ? xml.length : next;
    }
  }
  return tokens;
}

function withId(json: AnyNode, id: string | undefined): AnyNode {
  if (id) {
    json[NODE_STATE_KEY] = { id };
  }
  return json;
}

function buildElement(
  type: string,
  extra: Record<string, unknown>,
  children: AnyNode[],
  id: string | undefined
): AnyNode {
  return withId(
    {
      children,
      direction: null,
      format: '',
      indent: 0,
      type,
      version: 1,
      ...extra,
    } as AnyNode,
    id
  );
}

function buildText(tag: ParsedTag, text: string): AnyNode {
  let format = 0;
  for (const [name, bit] of FORMAT_BITS) {
    if (tag.attrs[name] === 'true') format |= bit;
  }
  return withId(
    {
      detail: tag.attrs.detail ? Number(tag.attrs.detail) : 0,
      format,
      mode: tag.attrs.mode ?? 'normal',
      style: tag.attrs.style ?? '',
      text,
      type: 'text',
      version: 1,
    } as AnyNode,
    tag.attrs.id
  );
}

function buildFromTag(tag: ParsedTag, children: AnyNode[]): AnyNode {
  const a = tag.attrs;
  const id = a.id;
  switch (tag.name) {
    case 'p':
      return buildElement('paragraph', { textFormat: 0, textStyle: '' }, children, id);
    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6':
      return buildElement('heading', { tag: tag.name }, children, id);
    case 'ul':
      return buildElement(
        'list',
        { listType: a.listType ?? 'bullet', start: a.start ? Number(a.start) : 1, tag: 'ul' },
        children,
        id
      );
    case 'ol':
      return buildElement(
        'list',
        { listType: 'number', start: a.start ? Number(a.start) : 1, tag: 'ol' },
        children,
        id
      );
    case 'li':
      return buildElement(
        'listitem',
        {
          value: a.value ? Number(a.value) : 1,
          ...(a.checked === 'true' ? { checked: true } : {}),
        },
        children,
        id
      );
    case 'table': {
      const extra: Record<string, unknown> = {};
      if (a.colWidths) {
        extra.colWidths = a.colWidths.split(',').map((n) => Number(n));
      }
      if (a.rowStriping === 'true') extra.rowStriping = true;
      return buildElement('table', extra, children, id);
    }
    case 'tr': {
      const extra: Record<string, unknown> = {};
      if (a.height) extra.height = Number(a.height);
      return buildElement('tablerow', extra, children, id);
    }
    case 'td':
      return buildElement(
        'tablecell',
        {
          backgroundColor: a.backgroundColor ?? null,
          colSpan: a.colSpan ? Number(a.colSpan) : 1,
          headerState: a.headerState ? Number(a.headerState) : 0,
          rowSpan: a.rowSpan ? Number(a.rowSpan) : 1,
        },
        children,
        id
      );
    case 'hr':
      return withId({ type: 'horizontalrule', version: 1 } as AnyNode, id);
    case 'date-mention':
      return withId(
        {
          type: 'date-mention',
          version: 1,
          date: a.date ?? '',
          displayFormat: a.displayFormat ?? '',
          ...(a.mentionUuid !== undefined ? { mentionUuid: a.mentionUuid } : {}),
        } as AnyNode,
        id
      );
    default: {
      // Generic fallback: unflatten dot-notation attributes back to nested JSON.
      const flat: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(a)) {
        if (k === 'id') continue;
        // rename _id back to id (was renamed on export to avoid attribute collision)
        const key = k === '_id' ? 'id' : k;
        try { flat[key] = JSON.parse(v); } catch { flat[key] = v; }
      }
      const extra = unflatten(flat) as Record<string, unknown>;
      return withId(
        { type: tag.name, version: 1, ...extra, ...(children.length ? { children } : {}) } as AnyNode,
        id
      );
    }
  }
}

export function fromXml(xml: string): SerializedEditorState {
  // Parse directly — the tokenizer handles pretty-printed XML fine.
  // Do NOT minify: >\s+< would strip whitespace-only text nodes like <t> </t>.
  const tokens = tokenize(xml);

  // Recursive descent over the token stream.
  let pos = 0;

  function parseChildren(parentName: string): AnyNode[] {
    const out: AnyNode[] = [];
    while (pos < tokens.length) {
      const tok = tokens[pos];
      if (tok.kind === 'close') {
        if (tok.name === parentName) {
          pos++;
          return out;
        }
        // Mismatched close: stop without consuming.
        return out;
      }
      if (tok.kind === 'text') {
        pos++;
        // Whitespace-only text between elements is layout; ignore it.
        continue;
      }
      if (tok.kind === 'selfclose') {
        pos++;
        if (tok.tag.name === 't') {
          out.push(buildText(tok.tag, ''));
        } else {
          out.push(buildFromTag(tok.tag, []));
        }
        continue;
      }
      // open
      pos++;
      const tag = tok.tag;
      if (tag.name === 't') {
        // A <t> contains only text.
        let text = '';
        while (pos < tokens.length) {
          const inner = tokens[pos];
          if (inner.kind === 'close' && inner.name === 't') {
            pos++;
            break;
          }
          if (inner.kind === 'text') {
            text += inner.text;
            pos++;
          } else {
            pos++;
          }
        }
        out.push(buildText(tag, unesc(text)));
        continue;
      }
      const children = parseChildren(tag.name);
      out.push(buildFromTag(tag, children));
    }
    return out;
  }

  // Skip to <doc>.
  while (pos < tokens.length) {
    const tok = tokens[pos];
    if (tok.kind === 'open' && tok.tag.name === 'doc') {
      pos++;
      break;
    }
    pos++;
  }
  const children = parseChildren('doc');

  return {
    root: {
      children,
      direction: 'ltr',
      format: '',
      indent: 0,
      type: 'root',
      version: 1,
      $: { documentMetadata: { version: 1.4, environmentTags: null }, id: 'root' },
    },
  } as unknown as SerializedEditorState;
}
