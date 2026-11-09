import type * as Original from 'lexical';
import {
  $getState,
  $getStateChange,
  $getWritableNodeState,
  $setState,
  type DOMChildConversion,
  type DOMSlotForNode,
  type ElementNode,
  type KlassConstructor,
  type LexicalNodeReplacement,
  type NodeStateJSON,
  type SerializedEditorState,
  type SerializedTextNode,
  type StateConfig,
  type StateConfigKey,
  type StateConfigValue,
  type StaticNodeConfigRecord,
  type TextNode,
  type Transform,
} from '../index';

declare const actualSerialized: SerializedTextNode;
declare const originalSerialized: Original.SerializedTextNode;
export const originalData: Original.SerializedTextNode = actualSerialized;
export const actualData: SerializedTextNode = originalSerialized;
declare const actualState: SerializedEditorState;
export const originalState: Original.SerializedEditorState = actualState;
declare const originalReplacement: Original.LexicalNodeReplacement;
export const canonicalReplacement: LexicalNodeReplacement = originalReplacement;
declare const originalConfigRecord: Original.StaticNodeConfigRecord<
  'record',
  { type: 'record' }
>;
export const canonicalConfigRecord: StaticNodeConfigRecord<
  'record',
  { type: 'record' }
> = originalConfigRecord;

export function actualStateTypes(
  node: TextNode,
  previous: TextNode,
  config: StateConfig<'count', number>
) {
  const key: StateConfigKey<typeof config> = 'count';
  const value: StateConfigValue<typeof config> = $getState(node, config);
  const updated: TextNode = $setState(node, config, (before) => before + 1);
  const changed: [number, number] | null = $getStateChange(
    node,
    previous,
    config
  );
  const writable = $getWritableNodeState(node);
  const serialized: NodeStateJSON<TextNode> = writable.toJSON();
  return { key, value, updated, changed, serialized };
}
export const actualChild: DOMChildConversion = (node, parent) => parent ?? node;
export const actualTransform: Transform<TextNode> = (node) => {
  node.setTextContent('transformed');
};
declare const element: ElementNode;
export const actualSlot: DOMSlotForNode<ElementNode> = element.getDOMSlot(
  document.createElement('div')
);

class ActualLocal {
  private readonly value = 1;
  static marker = 'actual';
  read(): number {
    return this.value;
  }
}
export const canonicalConstructor: KlassConstructor<typeof ActualLocal> =
  ActualLocal;
declare const localConstructor: KlassConstructor<typeof ActualLocal>;
export const actualConstructor: typeof ActualLocal = localConstructor;
export const localInstance: ActualLocal = new localConstructor();
export const localStatic: string = localConstructor.marker;
