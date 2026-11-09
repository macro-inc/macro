import { assumeNodeType } from '../compatibility-exceptions';
import { RangeSelection } from '../selection/range';
import { elementFormat, elementFormats } from './format';
import { ElementNode, LexicalNode } from './index';
import {
  booleanResult,
  directionResult,
  modeResult,
  numberResult,
  stringResult,
} from './results';
import {
  getNodeRuntime,
  isNativeHydration,
  nodeCall,
  nodeField,
} from './runtime';

export function nodeByKey<T extends LexicalNode = LexicalNode>(
  key: string
): T | null {
  const node = getNodeRuntime().call('lexical.$getNodeByKey', [key]);
  if (node === null) return null;
  if (!(node instanceof LexicalNode)) throw new Error('expected a model node');
  return assumeNodeType<T>(node);
}

export function nodeLatest<N extends LexicalNode>(node: N): N {
  const latest = nodeByKey<N>(stringResult(nodeField(node, '__key')));
  if (latest === null)
    throw new Error(
      'Lexical node does not exist in active editor state. Avoid using the same node references between nested closures from editorState.read/editor.update.'
    );
  return latest;
}

export function nodeWritable<N extends LexicalNode>(node: N): N {
  const writable = nodeCall(node, 'getWritable', []);
  if (
    !(writable instanceof LexicalNode) ||
    writable.getKey() !== node.getKey() ||
    Object.getPrototypeOf(writable) !== Object.getPrototypeOf(node)
  )
    throw new Error('writable model node changed class or key');
  return assumeNodeType<N>(writable);
}

export function nodeSelect(
  node: LexicalNode,
  method: string,
  args: readonly unknown[]
): RangeSelection {
  const selection = nodeCall(node, method, args);
  if (!(selection instanceof RangeSelection))
    throw new Error(
      'backend must decode and bind the actual RangeSelection before returning'
    );
  return selection;
}

export function nodeWriteField(
  node: LexicalNode,
  field: string,
  value: unknown
): void {
  if (isNativeHydration()) return;
  switch (field) {
    case '__text':
      nodeCall(node, 'setTextContent', [stringResult(value)]);
      return;
    case '__style':
      nodeCall(node, 'setStyle', [stringResult(value)]);
      return;
    case '__format':
      if (node instanceof ElementNode) {
        const format = numberResult(value);
        const type = elementFormat(format);
        if (elementFormats[type] !== format)
          throw new Error(
            'backend raw element-format write capability is required'
          );
        nodeCall(node, 'setFormat', [type]);
      } else nodeCall(node, 'setFormat', [numberResult(value)]);
      return;
    case '__detail':
      nodeCall(node, 'setDetail', [numberResult(value)]);
      return;
    case '__mode':
      nodeCall(node, 'setMode', [modeResult(value)]);
      return;
    case '__indent':
      nodeCall(node, 'setIndent', [numberResult(value)]);
      return;
    case '__dir':
      nodeCall(node, 'setDirection', [directionResult(value)]);
      return;
    case '__textFormat':
      nodeCall(node, 'setTextFormat', [numberResult(value)]);
      return;
    case '__textStyle':
      nodeCall(node, 'setTextStyle', [stringResult(value)]);
      return;
    default:
      throw new Error(
        `backend field-write capability is required for ${field}`
      );
  }
}

export function nodeIsDirty(node: LexicalNode): boolean {
  return booleanResult(nodeCall(node, 'isDirty', []));
}

export function nodeIsComposing(node: LexicalNode): boolean {
  return booleanResult(nodeCall(node, 'isComposing', []));
}
