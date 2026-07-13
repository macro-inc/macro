import { $convertFromMarkdownString } from '@lexical/markdown';
import { $unwrapNode } from '@lexical/utils';
import {
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  type EditorConfig,
  ElementNode,
  type LexicalEditor,
  type LexicalNode,
  type NodeKey,
  type SerializedElementNode,
  type Spread,
} from 'lexical';
import { createDOMWithFactory } from '../domFactoryRegistry';
import { $applyIdFromSerialized } from '../plugins/nodeIdPlugin';
import { ALL_TRANSFORMERS } from '../transformers';
import { $findDiffDeleteNodeAncestor } from './DiffDeleteNode';
import { $isDiffInsertNode } from './DiffInsertNode';

export type DiffInfo = {
  userId: string;
  label?: string;
};

export type SerializedDiffNode = Spread<
  {
    userId: string;
    label?: string;
  },
  SerializedElementNode
>;

export class DiffNode extends ElementNode {
  __userId: string;
  __label: string;

  static getType() {
    return 'diff';
  }

  constructor(userId: string, label?: string, key?: NodeKey) {
    super(key);
    this.__userId = userId;
    this.__label = label ?? 'AI Suggestion';
  }

  static clone(node: DiffNode) {
    return new DiffNode(node.__userId, node.__label, node.__key);
  }

  isInline(): boolean {
    return false;
  }

  isKeyboardSelectable(): boolean {
    return true;
  }

  createDOM(config: EditorConfig, editor: LexicalEditor) {
    return createDOMWithFactory(this, config, editor, () => {
      const container = document.createElement('div');
      container.className = 'md-diff';
      container.setAttribute('data-diff-user-id', this.__userId);
      container.setAttribute('data-diff-label', this.__label);
      return container;
    });
  }

  updateDOM() {
    return false;
  }

  static importJSON(serializedNode: SerializedDiffNode): DiffNode {
    const diffNode = new DiffNode(serializedNode.userId, serializedNode.label);
    $applyIdFromSerialized(diffNode, serializedNode);
    return diffNode;
  }

  exportJSON(): SerializedDiffNode {
    return {
      ...super.exportJSON(),
      userId: this.__userId,
      label: this.__label,
    };
  }

  exportComponentProps(): DiffInfo {
    return {
      userId: this.__userId,
      label: this.__label,
    };
  }

  getLabel() {
    return this.__label;
  }

  setLabel(label: string) {
    const self = this.getWritable();
    self.__label = label;
    return self;
  }

  getUserId() {
    return this.__userId;
  }

  setUserId(userId: string) {
    const self = this.getWritable();
    self.__userId = userId;
    return self;
  }

  handleAccept(editor: LexicalEditor) {
    editor.update(() => {
      const diffInsertNode = this.getChildren().find((child) =>
        $isDiffInsertNode(child)
      );
      if (!diffInsertNode) return;

      const insertMarkdown = diffInsertNode.getMarkdown();
      if (insertMarkdown === undefined) return;

      this.clear();

      $convertFromMarkdownString(insertMarkdown, ALL_TRANSFORMERS, this, false);

      const lastChild = this.getLastChild();
      $unwrapNode(this);
      if (lastChild) {
        lastChild.selectEnd();
      }
    });
  }

  handleReject(editor: LexicalEditor) {
    editor.update(() => {
      const diffDeleteNode = this.getChildren().find(
        (child) => child.getType() === 'diff-delete'
      );
      if (!diffDeleteNode) {
        this.remove();
        return;
      }

      let lastChild: LexicalNode | null = null;
      if (diffDeleteNode.getType() === 'diff-delete') {
        for (const child of (diffDeleteNode as any).getChildren()) {
          this.insertBefore(child);
          lastChild = child;
        }
      }

      this.remove();
      if (lastChild) {
        lastChild.selectEnd();
      }
    });
  }
}

export function $createDiffNode(userId: string, label?: string): DiffNode {
  return new DiffNode(userId, label);
}

export function $isDiffNode(node: LexicalNode | null): node is DiffNode {
  return node instanceof DiffNode;
}

/**
 * Handler for checking if selection is at start of a DiffDeleteNode and unwrapping it if so. Used
 * in the diff plugin for handling custom delete behavior.
 * @returns
 */
export function $diffNodeDeleteAtStart() {
  const selection = $getSelection();
  if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
    return false;
  }

  const node = selection.focus.getNode();

  if (selection.anchor.offset !== 0) {
    return false;
  }
  // Check for start.
  const parentElement = node.getParentOrThrow();
  const isAtStart = parentElement.getFirstChild()?.is(node);
  if (!isAtStart) {
    return false;
  }

  const diffDeleteNode = $findDiffDeleteNodeAncestor(parentElement);
  if (!diffDeleteNode) {
    return false;
  }

  const diffNode = diffDeleteNode.getParent();
  if (!$isDiffNode(diffNode)) {
    return false;
  }

  const nodesToInsert = [];
  for (const child of diffDeleteNode.getChildren()) {
    if ($isElementNode(child)) {
      nodesToInsert.push(child);
    }
  }

  const previousSibling = diffNode.getPreviousSibling();
  if (previousSibling) {
    for (const node of nodesToInsert) {
      previousSibling.insertAfter(node);
    }
  } else {
    const parent = diffNode.getParent();
    if (parent) {
      for (let i = nodesToInsert.length - 1; i >= 0; i--) {
        diffNode.insertBefore(nodesToInsert[i]);
      }
    }
  }

  if (nodesToInsert.length > 0) {
    nodesToInsert[0].selectStart();
  }

  diffNode.remove();

  return true;
}
