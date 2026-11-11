import { LexicalNode } from './base';
import {
  DecoratorNode,
  LineBreakNode,
  ParagraphNode,
  RootNode,
} from './builtins';
import { ElementNode } from './element';
import { nodeField, nodeWriteField, withNativeHydration } from './runtime';
import { TabNode } from './tab';
import { TextNode } from './text';

export {
  DecoratorNode,
  ElementNode,
  LexicalNode,
  LineBreakNode,
  ParagraphNode,
  RootNode,
  TabNode,
  TextNode,
};

export function defineNodeFields(node: LexicalNode): void {
  const fields = ['__type', '__key', '__parent', '__prev', '__next'];
  if (node instanceof ElementNode)
    fields.push(
      '__first',
      '__last',
      '__size',
      '__format',
      '__style',
      '__indent',
      '__dir',
      '__textFormat',
      '__textStyle'
    );
  else if (node instanceof TextNode)
    fields.push('__text', '__format', '__style', '__mode', '__detail');
  if (node instanceof RootNode) fields.push('__cachedText');
  for (const field of [...fields, '__state']) {
    Object.defineProperty(node, field, {
      enumerable: field !== '__state',
      configurable: true,
      get: () => nodeField(node, field),
      set: (value: unknown) => nodeWriteField(node, field, value),
    });
  }
}

/** Hydrate builtins with their actual typed classes and no new model record. */
export function nativeNode(type: string): LexicalNode {
  return withNativeHydration(() => {
    switch (type) {
      case 'root':
        return new RootNode();
      case 'paragraph':
        return new ParagraphNode();
      case 'text':
        return new TextNode();
      case 'tab':
        return new TabNode();
      case 'linebreak':
        return new LineBreakNode();
      default:
        throw new Error(`unregistered JS node type ${type}`);
    }
  });
}
