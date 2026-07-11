import { bitflag, defineBitflags } from 'bitf';
import { flatten } from 'flat';
import { match } from 'ts-pattern';
import type {
  CustomCodeNode,
  KnownNode,
  SerNode,
  TableCellNode,
  TableNode,
  TableRowNode,
  TextNode,
  UnknownNode,
} from './nodes';

export interface FxpElementNode {
  ':@'?: Record<string, string>;
  [key: string]: FxpNode[] | Record<string, string> | undefined;
}
export type FxpNode = FxpElementNode | { '#text': string };

const FORMAT_FLAGS = defineBitflags({
  bold: 1 << 0,
  italic: 1 << 1,
  strikethrough: 1 << 2,
  underline: 1 << 3,
  code: 1 << 4,
  subscript: 1 << 5,
  superscript: 1 << 6,
});

function encodeFormat(format: number): Record<string, string> {
  return Object.fromEntries(
    Object.entries(FORMAT_FLAGS)
      .filter(([, bit]) => bitflag(format).has(bit))
      .map(([name]) => [name, 'true'])
  );
}

function el(
  tag: string,
  kids: FxpNode[],
  attrs: Record<string, string> = {}
): FxpNode {
  return { [tag]: kids, ...(Object.keys(attrs).length && { ':@': attrs }) };
}

function nodeAttrs(
  node: { $?: { id: string } },
  extra: Record<string, string> = {}
): Record<string, string> {
  return node.$?.id ? { id: node.$.id, ...extra } : extra;
}

function container(
  tag: string,
  node: { $?: { id: string }; children: SerNode[] },
  extra: Record<string, string> = {}
): FxpNode {
  return el(tag, node.children.map(serializeNode), nodeAttrs(node, extra));
}

const KNOWN_TYPES: Record<KnownNode['type'], 1> = {
  text: 1,
  linebreak: 1,
  paragraph: 1,
  heading: 1,
  quote: 1,
  list: 1,
  listitem: 1,
  table: 1,
  tablerow: 1,
  tablecell: 1,
  horizontalrule: 1,
  'date-mention': 1,
  link: 1,
  autolink: 1,
  mark: 1,
  tab: 1,
  'classed-block': 1,
  'custom-code': 1,
  equation: 1,
  image: 1,
  video: 1,
  'html-render': 1,
  'document-card': 1,
  'user-mention': 1,
  'document-mention': 1,
  'contact-mention': 1,
  'group-mention': 1,
  'pr-mention': 1,
  'theme-mention': 1,
  'unknown-mention': 1,
};

function isKnownNode(node: SerNode): node is KnownNode {
  return node.type in KNOWN_TYPES;
}

// Lexical bookkeeping fields that carry no meaning for a reader of the doc.
const NOISE_KEYS = new Set(['version', 'direction', 'indent']);

function serUnknown(n: UnknownNode): FxpNode {
  const { type, children, ...rest } = n;
  // this makes an object of attributes into dotted notation
  // e.g. { $: { id: 'foo' } } -> { '$.id': 'foo' }
  // since we are unidirectional rn this is fine
  const flat = flatten(rest, { safe: true }) as Record<string, unknown>;
  const attrs: Record<string, string> = {};
  if (n.$?.id) attrs.id = n.$.id;
  for (const [k, v] of Object.entries(flat)) {
    if (k.startsWith('$') || NOISE_KEYS.has(k)) continue;
    if (v === null || v === undefined) {
      attrs[k] = 'null';
      continue;
    }
    attrs[k === 'id' ? '_id' : k] =
      typeof v === 'object' ? JSON.stringify(v) : String(v);
  }
  return el(type, (children ?? []).map(serializeNode), attrs);
}

/** Flatten a code block's per-token `code-highlight` / `linebreak` children back
 *  into one raw source string. Raw code is better for the LLMM than prism. */
function serializeCode(n: CustomCodeNode): FxpNode {
  const code = (n.children ?? [])
    .map((c) => (c.type === 'linebreak' ? '\n' : ((c as TextNode).text ?? '')))
    .join('');
  return el(
    'code',
    code ? [{ '#text': code }] : [],
    nodeAttrs(n, { ...(n.language && { language: n.language }) })
  );
}

/** A leaf node carrying only text content (equation TeX, raw html). */
function textLeaf(
  tag: string,
  n: { $?: { id: string } },
  text: string,
  extra: Record<string, string> = {}
): FxpNode {
  return el(tag, text ? [{ '#text': text }] : [], nodeAttrs(n, extra));
}

/** Keep an image/video src but redact a `data:` URI's payload to `...` so the
 *  model knows media is present without ingesting a base64 blob. */
function redactedSrc(url: string): string {
  if (!url.startsWith('data:')) return url;
  const comma = url.indexOf(',');
  const prefix = comma === -1 ? 'data:' : url.slice(0, comma + 1);
  return `${prefix}...`;
}

/** Serialize a table, stamping each cell with its 0-based `row`/`column` so the
 *  model can address `setCell` by coordinate without counting `<tr>`/`<td>`. */
function serializeTable(n: TableNode): FxpNode {
  // Rows/cells nest structurally inside a table, so the casts are safe; the
  // discriminated union can't narrow them (UnknownNode.type widens to string).
  let r = 0;
  const rows = n.children.map((child) => {
    if (child.type !== 'tablerow') return serializeNode(child);
    const row = child as TableRowNode;
    const rowIdx = r++;
    let c = 0;
    const cells = row.children.map((child) => {
      if (child.type !== 'tablecell') return serializeNode(child);
      const cell = child as TableCellNode;
      const colIdx = c++;
      return el(
        'td',
        cell.children.map(serializeNode),
        nodeAttrs(cell, {
          row: String(rowIdx),
          column: String(colIdx),
          ...(cell.headerState !== 0 && {
            headerState: String(cell.headerState),
          }),
          ...(cell.colSpan !== 1 && { colSpan: String(cell.colSpan) }),
          ...(cell.rowSpan !== 1 && { rowSpan: String(cell.rowSpan) }),
          ...(cell.backgroundColor && {
            backgroundColor: cell.backgroundColor,
          }),
        })
      );
    });
    return el(
      'tr',
      cells,
      nodeAttrs(
        row,
        row.height !== undefined ? { height: String(row.height) } : {}
      )
    );
  });
  return el(
    'table',
    rows,
    nodeAttrs(n, {
      ...(n.colWidths && { colWidths: n.colWidths.join(',') }),
      ...(n.rowStriping && { rowStriping: 'true' }),
    })
  );
}

export function serializeNode(node: SerNode): FxpNode {
  if (!isKnownNode(node)) return serUnknown(node as UnknownNode);
  return match(node)
    .with({ type: 'text' }, (n) => {
      const extra: Record<string, string> = { ...encodeFormat(n.format) };
      if (n.style) extra.style = n.style;
      if (n.detail) extra.detail = String(n.detail);
      if (n.mode && n.mode !== 'normal') extra.mode = n.mode;
      return el('t', n.text ? [{ '#text': n.text }] : [], nodeAttrs(n, extra));
    })
    .with({ type: 'linebreak' }, () => el('br', []))
    .with({ type: 'paragraph' }, (n) => container('p', n))
    .with({ type: 'heading' }, (n) => container(n.tag, n))
    .with({ type: 'quote' }, (n) => container('blockquote', n))
    .with({ type: 'listitem' }, (n) =>
      container('li', n, {
        ...(n.value !== 1 && { value: String(n.value) }),
        ...(n.checked && { checked: 'true' }),
      })
    )
    .with({ type: 'list' }, (n) =>
      container(n.listType === 'number' ? 'ol' : 'ul', n, {
        ...(n.listType === 'check' && { listType: 'check' }),
        ...(n.start !== 1 && { start: String(n.start) }),
      })
    )
    .with({ type: 'table' }, (n) => serializeTable(n))
    .with({ type: 'tablerow' }, (n) =>
      container(
        'tr',
        n,
        n.height !== undefined ? { height: String(n.height) } : {}
      )
    )
    .with({ type: 'tablecell' }, (n) =>
      container('td', n, {
        ...(n.headerState !== 0 && { headerState: String(n.headerState) }),
        ...(n.colSpan !== 1 && { colSpan: String(n.colSpan) }),
        ...(n.rowSpan !== 1 && { rowSpan: String(n.rowSpan) }),
        ...(n.backgroundColor && { backgroundColor: n.backgroundColor }),
      })
    )
    .with({ type: 'horizontalrule' }, (n) => el('hr', [], nodeAttrs(n)))
    .with({ type: 'date-mention' }, (n) =>
      el(
        'date-mention',
        [],
        nodeAttrs(n, {
          date: n.date,
          displayFormat: n.displayFormat,
          ...(n.mentionUuid !== undefined && { mentionUuid: n.mentionUuid }),
        })
      )
    )
    .with({ type: 'link' }, { type: 'autolink' }, (n) =>
      container('a', n, {
        href: n.url ?? '',
        ...(n.rel && { rel: n.rel }),
        ...(n.target && { target: n.target }),
        ...(n.title && { title: n.title }),
      })
    )
    .with({ type: 'mark' }, (n) => container('mark', n))
    .with({ type: 'tab' }, (n) => el('tab', [], nodeAttrs(n)))
    .with({ type: 'classed-block' }, (n) =>
      container('classed-block', n, {
        tag: n.tag,
        ...(n.classes?.length && { classes: n.classes.join(' ') }),
      })
    )
    .with({ type: 'custom-code' }, (n) => serializeCode(n))
    .with({ type: 'equation' }, (n) =>
      textLeaf('equation', n, n.equation, {
        ...(n.inline && { inline: 'true' }),
      })
    )
    .with({ type: 'image' }, (n) =>
      el(
        'image',
        [],
        nodeAttrs(n, {
          ...(n.alt && { alt: n.alt }),
          ...(n.url && { src: redactedSrc(n.url) }),
        })
      )
    )
    .with({ type: 'video' }, (n) =>
      el(
        'video',
        [],
        nodeAttrs(n, {
          ...(n.url && { src: redactedSrc(n.url) }),
          ...(n.controls && { controls: 'true' }),
        })
      )
    )
    .with({ type: 'html-render' }, (n) => textLeaf('html-render', n, n.html))
    .with({ type: 'document-card' }, (n) =>
      el(
        'document-card',
        [],
        nodeAttrs(n, {
          ...(n.documentId && { documentId: n.documentId }),
          ...(n.documentName && { name: n.documentName }),
        })
      )
    )
    .with({ type: 'user-mention' }, (n) =>
      el(
        'user-mention',
        [],
        nodeAttrs(n, {
          ...(n.userId && { userId: n.userId }),
          ...(n.email && { email: n.email }),
        })
      )
    )
    .with({ type: 'document-mention' }, (n) =>
      el(
        'document-mention',
        [],
        nodeAttrs(n, {
          ...(n.documentId && { documentId: n.documentId }),
          ...(n.documentName && { name: n.documentName }),
        })
      )
    )
    .with({ type: 'contact-mention' }, (n) =>
      el(
        'contact-mention',
        [],
        nodeAttrs(n, {
          ...(n.contactId && { contactId: n.contactId }),
          ...(n.name && { name: n.name }),
          ...(n.emailOrDomain && { email: n.emailOrDomain }),
          ...(n.isCompany && { isCompany: 'true' }),
        })
      )
    )
    .with({ type: 'group-mention' }, (n) =>
      el(
        'group-mention',
        [],
        nodeAttrs(n, { ...(n.groupAlias && { alias: n.groupAlias }) })
      )
    )
    .with({ type: 'pr-mention' }, (n) =>
      el(
        'pr-mention',
        [],
        nodeAttrs(n, {
          ...(n.id && { prId: n.id }),
          ...(n.label && { label: n.label }),
        })
      )
    )
    .with({ type: 'theme-mention' }, (n) =>
      el('theme-mention', [], nodeAttrs(n, { ...(n.name && { name: n.name }) }))
    )
    .with({ type: 'unknown-mention' }, (n) =>
      el(
        'unknown-mention',
        [],
        nodeAttrs(n, { ...(n.name && { name: n.name }) })
      )
    )
    .exhaustive();
}
