import { XMLBuilder } from 'fast-xml-parser';
import type { SerializedEditorState } from 'lexical';
import { type FxpNode, serializeNode } from './codecs';
import type { SerNode } from './nodes';

export type { SerializedEditorState } from 'lexical';

const builder = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  preserveOrder: true,
  textNodeName: '#text',
  suppressEmptyNode: true,
  format: true,
  indentBy: '  ',
});

/** Render element trees with the same builder the document XML uses. */
export function buildXml(nodes: FxpNode[]): string {
  return builder.build(nodes);
}

export function toXml(state: SerializedEditorState): string {
  const root = state.root as unknown as { children: SerNode[] };
  return builder.build([{ doc: root.children.map(serializeNode) }]);
}
