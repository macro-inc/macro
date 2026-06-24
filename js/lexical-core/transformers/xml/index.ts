import type { SerializedEditorState } from 'lexical'
import { XMLBuilder } from 'fast-xml-parser'
import { serializeNode } from './codecs'
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

