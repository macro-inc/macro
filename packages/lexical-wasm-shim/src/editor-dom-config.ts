import {
  type DOMSlot,
  ElementDOMSlot,
} from '../../lexical-wasm-view/src/compat/dom-slot';
import type { LexicalEditor } from './editor';
import { ElementNode, type LexicalNode } from './nodes';
import type {
  DOMSlotForNode,
  EditorDOMRenderConfig,
} from './nodes/editor-config';

function getNodeDOMSlot<N extends LexicalNode>(
  node: N,
  dom: HTMLElement,
  editor: LexicalEditor
): DOMSlotForNode<N>;
function getNodeDOMSlot(
  node: LexicalNode,
  dom: HTMLElement,
  _editor: LexicalEditor
): DOMSlot<HTMLElement> {
  const slot = node.getDOMSlot(dom);
  if (node instanceof ElementNode && !(slot instanceof ElementDOMSlot))
    throw new Error('ElementNode.getDOMSlot must return an ElementDOMSlot');
  return slot;
}

/** Default node hooks; editor-specific overrides preserve their original functions. */
export const DEFAULT_EDITOR_DOM_CONFIG: EditorDOMRenderConfig = {
  $createDOM: (node, editor) => node.createDOM(editor._config, editor),
  $decorateDOM: () => {},
  $exportDOM: (node, editor) => node.exportDOM(editor),
  $extractWithChild: (node, child, selection, destination) =>
    node instanceof ElementNode &&
    node.extractWithChild(child, selection, destination),
  $getDOMSlot: getNodeDOMSlot,
  $shouldExclude: (node) =>
    node instanceof ElementNode && node.excludeFromCopy('html'),
  $shouldInclude: (node, selection) =>
    selection ? node.isSelected(selection) : true,
  $updateDOM: (next, previous, dom, editor) =>
    next.updateDOM(previous, dom, editor._config),
};

export function getEditorDOMRenderConfig(
  editor: LexicalEditor
): EditorDOMRenderConfig {
  return editor._config.dom || DEFAULT_EDITOR_DOM_CONFIG;
}
