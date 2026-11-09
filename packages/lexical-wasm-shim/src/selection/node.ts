/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 * Licensed under the MIT license in the upstream Lexical source tree.
 */
import type { BaseSelection, LexicalNode, NodeKey } from 'lexical';
import { $getPreviousSelection, $getSelection } from './helpers';
import { getSelectionRuntime, isSelectionReadOnly } from './runtime';

export class NodeSelection implements BaseSelection {
  declare _nodes: Set<NodeKey>;
  declare _cachedNodes: LexicalNode[] | null;
  declare dirty: boolean;

  constructor(objects: Set<NodeKey>) {
    this._cachedNodes = null;
    this._nodes = objects;
    this.dirty = false;
  }

  getCachedNodes(): LexicalNode[] | null {
    return this._cachedNodes;
  }

  setCachedNodes(nodes: LexicalNode[] | null): void {
    this._cachedNodes = nodes;
  }

  is(selection: BaseSelection | null): boolean {
    if (!(selection instanceof NodeSelection)) {
      return false;
    }
    return (
      this._nodes.size === selection._nodes.size &&
      Array.from(this._nodes).every((key) => selection._nodes.has(key))
    );
  }

  isCollapsed(): boolean {
    return false;
  }
  isBackward(): boolean {
    return false;
  }
  getStartEndPoints(): null {
    return null;
  }

  add(key: NodeKey): void {
    this.dirty = true;
    this._nodes.add(key);
    this._cachedNodes = null;
  }

  delete(key: NodeKey): void {
    this.dirty = true;
    this._nodes.delete(key);
    this._cachedNodes = null;
  }

  clear(): void {
    this.dirty = true;
    this._nodes.clear();
    this._cachedNodes = null;
  }

  has(key: NodeKey): boolean {
    return this._nodes.has(key);
  }
  clone(): NodeSelection {
    return new NodeSelection(new Set(this._nodes));
  }
  extract(): LexicalNode[] {
    return this.getNodes();
  }
  insertRawText(_text: string): void {}
  insertText(): void {}

  insertNodes(nodes: LexicalNode[]): void {
    const runtime = getSelectionRuntime();
    const selected = this.getNodes();
    const last = selected[selected.length - 1];
    const selection = runtime.isTextNode(last)
      ? last.select()
      : last
          .getParentOrThrow()
          .select(
            last.getIndexWithinParent() + 1,
            last.getIndexWithinParent() + 1
          );
    selection.insertNodes(nodes);
    for (const node of selected) {
      node.remove();
    }
  }

  getNodes(): LexicalNode[] {
    if (this._cachedNodes !== null) {
      return this._cachedNodes;
    }
    const nodes: LexicalNode[] = [];
    for (const key of this._nodes) {
      const node = getSelectionRuntime().getNodeByKey(key);
      if (node !== null) {
        nodes.push(node);
      }
    }
    if (!isSelectionReadOnly()) {
      this._cachedNodes = nodes;
    }
    return nodes;
  }

  getTextContent(): string {
    let text = '';
    for (const node of this.getNodes()) {
      text += node.getTextContent();
    }
    return text;
  }

  deleteNodes(): void {
    const nodes = this.getNodes();
    if (($getSelection() || $getPreviousSelection()) === this && nodes[0]) {
      const caret = getSelectionRuntime().caret;
      const first = caret.$getSiblingCaret(nodes[0], 'next');
      caret.$setSelectionFromCaretRange(caret.$getCaretRange(first, first));
    }
    for (const node of nodes) {
      node.remove();
    }
  }
}
