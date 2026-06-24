import { bitflag, defineBitflags } from 'bitf'
import { flatten } from 'flat'
import { match } from 'ts-pattern'
import type {
  DateMentionNode, HeadingNode, HrNode, KnownNode,
  LineBreakNode, LinkNode, ListItemNode, ListNode,
  ParagraphNode, QuoteNode, SerNode,
  TableCellNode, TableNode, TableRowNode, TextNode, UnknownNode,
} from './nodes'

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

function el(tag: string, kids: FxpNode[], attrs: Record<string, string> = {}): FxpNode {
  return { [tag]: kids, ...(Object.keys(attrs).length && { ':@': attrs }) }
}

function nodeAttrs(node: { $?: { id: string } }, extra: Record<string, string> = {}): Record<string, string> {
  return node.$?.id ? { id: node.$.id, ...extra } : extra
}

function container(tag: string, node: { $?: { id: string }; children: SerNode[] }, extra: Record<string, string> = {}): FxpNode {
  return el(tag, node.children.map(serializeNode), nodeAttrs(node, extra))
}

const KNOWN_TYPES: Record<KnownNode['type'], 1> = {
  text: 1, linebreak: 1, paragraph: 1, heading: 1, quote: 1,
  list: 1, listitem: 1, table: 1, tablerow: 1, tablecell: 1,
  horizontalrule: 1, 'date-mention': 1, link: 1, autolink: 1,
}

function isKnownNode(node: SerNode): node is KnownNode {
  return node.type in KNOWN_TYPES
}

function serUnknown(n: UnknownNode): FxpNode {
  const { type, children, ...rest } = n
  const flat = flatten(rest, { safe: true }) as Record<string, unknown>
  const attrs: Record<string, string> = {}
  if (n.$?.id) attrs.id = n.$.id
  for (const [k, v] of Object.entries(flat)) {
    if (k.startsWith('$')) continue
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

