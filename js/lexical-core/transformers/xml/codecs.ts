import { bitflag, defineBitflags } from 'bitf'
import { flatten, unflatten } from 'flat'
import { match } from 'ts-pattern'
import type {
  DateMentionNode, HeadingNode, HrNode, KnownNode,
  LineBreakNode, LinkNode, ListItemNode, ListNode,
  ParagraphNode, QuoteNode, SerNode,
  TableCellNode, TableNode, TableRowNode, TextNode, UnknownNode,
} from './nodes'

export function unescXml(s: string): string {
  return s.replace(/&quot;/g, '"').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&')
}

type Attrs = Record<string, string>

export type FxpNode = { ':@'?: Record<string, string> } & Record<string, FxpNode[]>

const FORMAT_FLAGS = defineBitflags({
  bold:          1 << 0,
  italic:        1 << 1,
  strikethrough: 1 << 2,
  underline:     1 << 3,
  code:          1 << 4,
  subscript:     1 << 5,
  superscript:   1 << 6,
})

function encodeFormat(format: number): Record<string, string> {
  return Object.fromEntries(
    Object.entries(FORMAT_FLAGS)
      .filter(([, bit]) => bitflag(format).has(bit))
      .map(([name]) => [name, 'true'])
  )
}

function decodeFormat(attrs: Attrs): number {
  let f = 0
  for (const [name, bit] of Object.entries(FORMAT_FLAGS)) {
    if (attrs[name] === 'true') f = bitflag(f).add(bit)
  }
  return f
}

const ELE_DEFAULTS = {
  version: 1 as const,
  direction: null as string | null,
  format: '',
  indent: 0,
}

// ─── serialization helpers ────────────────────────────────────────────────────

function el(tag: string, kids: FxpNode[], attrs: Record<string, string> = {}): FxpNode {
  return { [tag]: kids, ...(Object.keys(attrs).length && { ':@': attrs }) }
}

function nodeAttrs(node: { $?: { id: string } }, extra: Record<string, string> = {}): Record<string, string> {
  return node.$?.id ? { id: node.$.id, ...extra } : extra
}

function container(tag: string, node: { $?: { id: string }; children: SerNode[] }, extra: Record<string, string> = {}): FxpNode {
  return el(tag, node.children.map(serializeNode), nodeAttrs(node, extra))
}

// ─── known types ──────────────────────────────────────────────────────────────

const KNOWN_TYPES: Record<KnownNode['type'], 1> = {
  text: 1, linebreak: 1, paragraph: 1, heading: 1, quote: 1,
  list: 1, listitem: 1, table: 1, tablerow: 1, tablecell: 1,
  horizontalrule: 1, 'date-mention': 1, link: 1, autolink: 1,
}

function isKnownNode(node: SerNode): node is KnownNode {
  return node.type in KNOWN_TYPES
}

const SKIP_KEYS = new Set(['type', 'children', '$'])

function serUnknown(n: UnknownNode): FxpNode {
  const { type, children, ...rest } = n
  const flat = flatten(rest, { safe: true }) as Record<string, unknown>
  const attrs: Record<string, string> = {}
  if (n.$?.id) attrs.id = n.$.id
  for (const [k, v] of Object.entries(flat)) {
    if (SKIP_KEYS.has(k) || k.startsWith('$')) continue
    if (v === null || v === undefined) { attrs[k] = 'null'; continue }
    attrs[k === 'id' ? '_id' : k] = typeof v === 'object' ? JSON.stringify(v) : String(v)
  }
  return el(type, (children ?? []).map(serializeNode), attrs)
}

export function serializeNode(node: SerNode): FxpNode {
  if (!isKnownNode(node)) return serUnknown(node as UnknownNode)
  return match(node)
    .with({ type: 'text' }, n => {
      const extra: Record<string, string> = { ...encodeFormat(n.format) }
      if (n.style)                       extra.style = n.style
      if (n.detail)                      extra.detail = String(n.detail)
      if (n.mode && n.mode !== 'normal') extra.mode = n.mode
      return el('t', n.text ? [{ '#text': n.text }] : [], nodeAttrs(n, extra))
    })
    .with({ type: 'linebreak' }, () =>
      el('br', []))
    .with({ type: 'paragraph' }, n =>
      container('p', n))
    .with({ type: 'heading' }, n =>
      container(n.tag, n))
    .with({ type: 'quote' }, n =>
      container('blockquote', n))
    .with({ type: 'listitem' }, n =>
      container('li', n, {
        ...(n.value !== 1 && { value: String(n.value) }),
        ...(n.checked    && { checked: 'true' }),
      }))
    .with({ type: 'list' }, n =>
      container(n.listType === 'number' ? 'ol' : 'ul', n, {
        ...(n.listType === 'check' && { listType: 'check' }),
        ...(n.start !== 1          && { start: String(n.start) }),
      }))
    .with({ type: 'table' }, n =>
      container('table', n, {
        ...(n.colWidths   && { colWidths: n.colWidths.join(',') }),
        ...(n.rowStriping && { rowStriping: 'true' }),
      }))
    .with({ type: 'tablerow' }, n =>
      container('tr', n, n.height !== undefined ? { height: String(n.height) } : {}))
    .with({ type: 'tablecell' }, n =>
      container('td', n, {
        ...(n.headerState !== 0 && { headerState: String(n.headerState) }),
        ...(n.colSpan !== 1     && { colSpan: String(n.colSpan) }),
        ...(n.rowSpan !== 1     && { rowSpan: String(n.rowSpan) }),
        ...(n.backgroundColor  && { backgroundColor: n.backgroundColor }),
      }))
    .with({ type: 'horizontalrule' }, n =>
      el('hr', [], nodeAttrs(n)))
    .with({ type: 'date-mention' }, n =>
      el('date-mention', [], nodeAttrs(n, {
        date: n.date, displayFormat: n.displayFormat,
        ...(n.mentionUuid !== undefined && { mentionUuid: n.mentionUuid }),
      })))
    .with({ type: 'link' }, { type: 'autolink' }, n =>
      container('a', n, {
        href: n.url ?? '',
        ...(n.rel    && { rel: n.rel }),
        ...(n.target && { target: n.target }),
        ...(n.title  && { title: n.title }),
      }))
    .exhaustive()
}

// ─── deserialization ──────────────────────────────────────────────────────────

export function desText(attrs: Attrs, text: string): TextNode {
  const node: TextNode = {
    type: 'text',
    text,
    format: decodeFormat(attrs),
    detail: attrs.detail ? Number(attrs.detail) : 0,
    mode: attrs.mode ?? 'normal',
    style: attrs.style ?? '',
    version: 1,
  }
  if (attrs.id) node.$ = { id: attrs.id }
  return node
}

function desLineBreak(): LineBreakNode {
  return { type: 'linebreak', version: 1 }
}

function desParagraph(attrs: Attrs, children: SerNode[]): ParagraphNode {
  const node: ParagraphNode = { ...ELE_DEFAULTS, type: 'paragraph', children, textFormat: 0, textStyle: '' }
  if (attrs.id) node.$ = { id: attrs.id }
  return node
}

function desHeading(tag: string, attrs: Attrs, children: SerNode[]): HeadingNode {
  const node: HeadingNode = { ...ELE_DEFAULTS, type: 'heading', children, tag: tag as HeadingNode['tag'] }
  if (attrs.id) node.$ = { id: attrs.id }
  return node
}

function desQuote(attrs: Attrs, children: SerNode[]): QuoteNode {
  const node: QuoteNode = { ...ELE_DEFAULTS, type: 'quote', children }
  if (attrs.id) node.$ = { id: attrs.id }
  return node
}

function desList(tag: 'ul' | 'ol', attrs: Attrs, children: SerNode[]): ListNode {
  const listType = tag === 'ol' ? 'number' : ((attrs.listType ?? 'bullet') as ListNode['listType'])
  const node: ListNode = {
    ...ELE_DEFAULTS, type: 'list', children,
    listType,
    start: attrs.start ? Number(attrs.start) : 1,
    tag,
  }
  if (attrs.id) node.$ = { id: attrs.id }
  return node
}

function desListItem(attrs: Attrs, children: SerNode[]): ListItemNode {
  const node: ListItemNode = {
    ...ELE_DEFAULTS, type: 'listitem', children,
    value: attrs.value ? Number(attrs.value) : 1,
  }
  if (attrs.checked === 'true') node.checked = true
  if (attrs.id) node.$ = { id: attrs.id }
  return node
}

function desTable(attrs: Attrs, children: SerNode[]): TableNode {
  const node: TableNode = { ...ELE_DEFAULTS, type: 'table', children }
  if (attrs.colWidths) node.colWidths = attrs.colWidths.split(',').map(Number)
  if (attrs.rowStriping === 'true') node.rowStriping = true
  if (attrs.id) node.$ = { id: attrs.id }
  return node
}

function desTableRow(attrs: Attrs, children: SerNode[]): TableRowNode {
  const node: TableRowNode = { ...ELE_DEFAULTS, type: 'tablerow', children }
  if (attrs.height) node.height = Number(attrs.height)
  if (attrs.id) node.$ = { id: attrs.id }
  return node
}

function desTableCell(attrs: Attrs, children: SerNode[]): TableCellNode {
  const node: TableCellNode = {
    ...ELE_DEFAULTS, type: 'tablecell', children,
    backgroundColor: attrs.backgroundColor ?? null,
    colSpan: attrs.colSpan ? Number(attrs.colSpan) : 1,
    headerState: attrs.headerState ? Number(attrs.headerState) : 0,
    rowSpan: attrs.rowSpan ? Number(attrs.rowSpan) : 1,
  }
  if (attrs.id) node.$ = { id: attrs.id }
  return node
}

function desHr(attrs: Attrs): HrNode {
  const node: HrNode = { type: 'horizontalrule', version: 1 }
  if (attrs.id) node.$ = { id: attrs.id }
  return node
}

function desDateMention(attrs: Attrs): DateMentionNode {
  const node: DateMentionNode = {
    type: 'date-mention', version: 1,
    date: attrs.date ?? '',
    displayFormat: attrs.displayFormat ?? '',
  }
  if (attrs.mentionUuid !== undefined) node.mentionUuid = attrs.mentionUuid
  if (attrs.id) node.$ = { id: attrs.id }
  return node
}

function desLink(attrs: Attrs, children: SerNode[]): LinkNode {
  const node: LinkNode = {
    ...ELE_DEFAULTS, type: 'link', children,
    url: attrs.href ?? '',
    rel: attrs.rel ?? null,
    target: attrs.target ?? null,
    title: attrs.title ?? null,
  }
  if (attrs.id) node.$ = { id: attrs.id }
  return node
}

function desUnknown(tag: string, attrs: Attrs, children: SerNode[]): UnknownNode {
  const flat: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'id') continue
    const key = k === '_id' ? 'id' : k
    if (v === 'null') { flat[key] = null; continue }
    if (v === 'true') { flat[key] = true; continue }
    if (v === 'false') { flat[key] = false; continue }
    if (v.startsWith('{') || v.startsWith('[')) {
      try { flat[key] = JSON.parse(v) } catch { flat[key] = v }
      continue
    }
    const num = Number(v)
    flat[key] = !Number.isNaN(num) && v.trim() !== '' ? num : v
  }
  const extra = unflatten(flat) as Record<string, unknown>
  const node = { type: tag, version: 1, ...extra } as UnknownNode
  if (children.length) node.children = children
  if (attrs.id) node.$ = { id: attrs.id }
  return node
}

const DESERIALIZERS: Record<string, (attrs: Attrs, children: SerNode[]) => SerNode> = {
  t:              () => { throw new Error('text nodes are handled by the tokenizer') },
  br:             () => desLineBreak(),
  p:              (a, c) => desParagraph(a, c),
  h1:             (a, c) => desHeading('h1', a, c),
  h2:             (a, c) => desHeading('h2', a, c),
  h3:             (a, c) => desHeading('h3', a, c),
  h4:             (a, c) => desHeading('h4', a, c),
  h5:             (a, c) => desHeading('h5', a, c),
  h6:             (a, c) => desHeading('h6', a, c),
  blockquote:     (a, c) => desQuote(a, c),
  ul:             (a, c) => desList('ul', a, c),
  ol:             (a, c) => desList('ol', a, c),
  li:             (a, c) => desListItem(a, c),
  table:          (a, c) => desTable(a, c),
  tr:             (a, c) => desTableRow(a, c),
  td:             (a, c) => desTableCell(a, c),
  hr:             (a)    => desHr(a),
  'date-mention': (a)    => desDateMention(a),
  a:              (a, c) => desLink(a, c),
}

export function deserializeTag(tag: string, attrs: Attrs, children: SerNode[]): SerNode {
  return DESERIALIZERS[tag]?.(attrs, children) ?? desUnknown(tag, attrs, children)
}
