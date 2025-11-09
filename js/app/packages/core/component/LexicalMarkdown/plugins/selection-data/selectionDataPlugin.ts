/**
 * @file A plugin in that binds Lexical selection updates to a Solid store.
 */

import { $isAutoLinkNode, $isLinkNode } from '@lexical/link';
import type { ListNode } from '@lexical/list';
// import { mergeRegister } from '@lexical/utils';
import type { HeadingNode } from '@lexical/rich-text';
import type { ElementName } from '@lexical-core';
import {
  $getSelection,
  $isNodeSelection,
  $isRangeSelection,
  type BaseSelection,
  type ElementNode,
  type LexicalEditor,
  type NodeKey,
  type NodeSelection,
  type RangeSelection,
} from 'lexical';
import { createStore, type SetStoreFunction } from 'solid-js/store';
import type { LexicalWrapper } from '../../context/LexicalWrapperContext';

export type Selection = NodeSelection | RangeSelection | null;

/**
 * Useful data about Lexical's current selection. If the selection is Lexical
 * RangeSelection then the elementsInRange set will be populated with the names
 * of all unique element types in the selection. If the selection is a
 * NodeSelection then the nodeKeys set will be populated with the keys of all
 * unique nodes in the selection. The boolean flags for text styles (i.e. bold)
 * are only valid if the selection is a RangeSelection.
 */
export type SelectionData = {
  type: 'range' | 'node' | null;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strikethrough: boolean;
  code: boolean;
  superscript: boolean;
  subscript: boolean;
  highlight: boolean;
  elementsInRange: Set<ElementName>;
  nodeKeys: Set<NodeKey>;
  hasLinks: boolean;
};

export const defaultSelectionData: SelectionData = {
  type: null,
  bold: false,
  italic: false,
  underline: false,
  strikethrough: false,
  code: false,
  superscript: false,
  subscript: false,
  highlight: false,
  elementsInRange: new Set(),
  nodeKeys: new Set(),
  hasLinks: false,
};

function resetSelectionData(setSelectionData: SetStoreFunction<SelectionData>) {
  setSelectionData(structuredClone(defaultSelectionData));
}

export function createSelectionData() {
  return createStore<SelectionData>(structuredClone(defaultSelectionData));
}

export function $getSelectionData(
  selection: BaseSelection | null
): SelectionData {
  const data = structuredClone(defaultSelectionData);
  if (selection === null) return data;

  if ($isRangeSelection(selection)) {
    data.type = 'range';
    data.bold = selection.hasFormat('bold');
    data.italic = selection.hasFormat('italic');
    data.underline = selection.hasFormat('underline');
    data.strikethrough = selection.hasFormat('strikethrough');
    data.code = selection.hasFormat('code');
    data.superscript = selection.hasFormat('superscript');
    data.subscript = selection.hasFormat('subscript');
    data.highlight = selection.hasFormat('highlight');
    data.elementsInRange = $extractNodeTypes(selection);
    data.hasLinks = $hasLinks(selection);
  }

  if ($isNodeSelection(selection)) {
    data.type = 'node';
    data.nodeKeys = new Set(selection._nodes);
  }

  return data;
}

function registerselectionDataPlugin(
  editor: LexicalEditor,
  setSelectionData: SetStoreFunction<SelectionData>
) {
  resetSelectionData(setSelectionData);
  return editor.registerUpdateListener(({ editorState }) => {
    editorState.read(() => {
      const selection = $getSelection();
      setSelectionData($getSelectionData(selection));
    });
  });
}

export function nodeType(node: ElementNode): ElementName {
  const t = node.getType();
  if (t === 'list') {
    return (t + '-' + (node as ListNode).getListType()) as ElementName;
  }
  if (t === 'heading') {
    // slice the number out of 'h1' or 'h2'
    return (t + (node as HeadingNode).getTag().slice(1)) as ElementName;
  }
  return t as ElementName;
}

export function $extractNodeTypes(selection: RangeSelection): Set<ElementName> {
  const anchorParent = selection.anchor.getNode().getTopLevelElement();
  const focusParent = selection.focus.getNode().getTopLevelElement();
  const nodeTypes = new Set<ElementName>();

  if (!anchorParent || !focusParent) return nodeTypes;

  // if same top level parent, return type.
  if (anchorParent.is(focusParent)) {
    nodeTypes.add(nodeType(anchorParent));
    return nodeTypes;
  }

  // which node comes first in the doc.
  const anchorIndex = anchorParent.getIndexWithinParent();
  const focusIndex = focusParent.getIndexWithinParent();

  const [startNode, endNode] =
    anchorIndex <= focusIndex
      ? [anchorParent, focusParent]
      : [focusParent, anchorParent];

  let currentNode: ElementNode | null = startNode;

  nodeTypes.add(nodeType(currentNode));

  // Walk through siblings until we reach the end node
  while (currentNode && !currentNode.is(endNode)) {
    currentNode = currentNode.getNextSibling();
    if (!currentNode) {
      break;
    }
    let type = nodeType(currentNode);
    if (!nodeTypes.has(type)) {
      nodeTypes.add(type);
    }
  }
  return nodeTypes;
}

function $hasLinks(selection: RangeSelection) {
  if (selection.isCollapsed()) {
    const parent = selection.anchor.getNode().getParent();
    if (!parent) return false;
    return $isLinkNode(parent) || $isAutoLinkNode(parent);
  }
  return selection
    .getNodes()
    .some(
      (node) =>
        $isLinkNode(node) ||
        $isAutoLinkNode(node) ||
        $isLinkNode(node.getParent()) ||
        $isAutoLinkNode(node.getParent())
    );
}

export function selectionDataPlugin(lexicalWrapper?: LexicalWrapper) {
  const [selectionData, setSelectionData] = createSelectionData();
  if (lexicalWrapper) {
    lexicalWrapper.selection = selectionData;
  }
  return (editor: LexicalEditor) => {
    return registerselectionDataPlugin(editor, setSelectionData);
  };
}

export function customSelectionDataPlugin(
  wrapper: LexicalWrapper,
  selectionData: SelectionData,
  setSelectionData: SetStoreFunction<SelectionData>
) {
  wrapper.selection = selectionData;
  return () => {
    return registerselectionDataPlugin(wrapper.editor, setSelectionData);
  };
}
