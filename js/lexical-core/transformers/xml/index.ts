import type { SerializedEditorState } from 'lexical'
import { XMLBuilder } from 'fast-xml-parser'
import { deserializeTag, desText, serializeNode, unescXml } from './codecs'
import type { SerNode } from './nodes'

export type { SerializedEditorState } from 'lexical'
export type { SerNode, KnownNode, TextNode, ParagraphNode, HeadingNode } from './nodes'

const builder = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  preserveOrder: true,
  textNodeName: '#text',
  suppressEmptyNode: true,
  format: true,
  indentBy: '  ',
})

export function toXml(state: SerializedEditorState): string {
  const root = state.root as unknown as { children: SerNode[] }
  return builder.build([{ doc: root.children.map(serializeNode) }])
}


interface ParsedTag {
  name: string
  attrs: Record<string, string>
}

type Token =
  | { kind: 'open';      tag: ParsedTag }
  | { kind: 'close';     name: string }
  | { kind: 'selfclose'; tag: ParsedTag }
  | { kind: 'text';      text: string }

function parseAttrs(raw: string): Record<string, string> {
  const result: Record<string, string> = {}
  const re = /([\w.\-]+)="([^"]*)"/g
  let m: RegExpExecArray | null
  while ((m = re.exec(raw)) !== null) result[m[1]] = unescXml(m[2])
  return result
}

function tokenize(xml: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  while (i < xml.length) {
    if (xml[i] !== '<') {
      const next = xml.indexOf('<', i)
      tokens.push({ kind: 'text', text: xml.slice(i, next === -1 ? undefined : next) })
      i = next === -1 ? xml.length : next
      continue
    }
    const end = xml.indexOf('>', i)
    if (end === -1) break
    const inner = xml.slice(i + 1, end)
    i = end + 1
    if (inner.startsWith('/')) {
      tokens.push({ kind: 'close', name: inner.slice(1).trim() })
      continue
    }
    const selfClosing = inner.endsWith('/')
    const body = selfClosing ? inner.slice(0, -1) : inner
    const spaceIdx = body.search(/\s/)
    const name = spaceIdx === -1 ? body.trim() : body.slice(0, spaceIdx)
    const tag: ParsedTag = { name, attrs: spaceIdx === -1 ? {} : parseAttrs(body.slice(spaceIdx)) }
    tokens.push(selfClosing ? { kind: 'selfclose', tag } : { kind: 'open', tag })
  }
  return tokens
}


export function fromXml(xml: string): SerializedEditorState {
  const tokens = tokenize(xml)
  let pos = 0

  function parseChildren(parentName: string): SerNode[] {
    const out: SerNode[] = []
    while (pos < tokens.length) {
      const tok = tokens[pos]
      if (tok.kind === 'close') {
        if (tok.name === parentName) pos++
        return out
      }
      if (tok.kind === 'text') { pos++; continue }
      if (tok.kind === 'selfclose') {
        pos++
        out.push(tok.tag.name === 't'
          ? desText(tok.tag.attrs, '')
          : deserializeTag(tok.tag.name, tok.tag.attrs, []))
        continue
      }
      // open tag
      pos++
      const { tag } = tok
      if (tag.name === 't') {
        let text = ''
        while (pos < tokens.length) {
          const inner = tokens[pos]
          if (inner.kind === 'close' && inner.name === 't') { pos++; break }
          if (inner.kind === 'text') { text += inner.text }
          pos++
        }
        out.push(desText(tag.attrs, unescXml(text)))
        continue
      }
      out.push(deserializeTag(tag.name, tag.attrs, parseChildren(tag.name)))
    }
    return out
  }

  // Advance to <doc>
  while (pos < tokens.length) {
    const tok = tokens[pos++]
    if (tok.kind === 'open' && tok.tag.name === 'doc') break
  }

  return {
    root: {
      children: parseChildren('doc'),
      direction: 'ltr',
      format: '',
      indent: 0,
      type: 'root',
      version: 1,
      $: { documentMetadata: { version: 1.4, environmentTags: null }, id: 'root' },
    },
  } as unknown as SerializedEditorState
}
