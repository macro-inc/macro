/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 * Licensed under the MIT license in the upstream Lexical source tree.
 */
import type {
  DOMExportOutput,
  KlassConstructor,
  LexicalUpdateJSON,
  SerializedLexicalNode,
} from 'lexical';

import { DOMSlot } from '../../../lexical-wasm-view/src/compat/dom-slot';
import { getActiveEditor, type LexicalEditor } from '../editor';
import type { BaseSelection } from '../selection';
import { $getSelection, $isRangeSelection } from '../selection/helpers';
import type { RangeSelection } from '../selection/range';
import type { BaseStaticNodeConfig, StaticNodeConfigValue } from './config';
import type { DOMConversionMap } from './dom-types';
import type { EditorConfig } from './editor-config';
import {
  DecoratorNode,
  defineNodeFields,
  ElementNode,
  ParagraphNode,
  TextNode,
} from './index';
import { $applyNodeReplacement } from './replacement/helpers';
import { isRootOrShadowRoot } from './results';
import {
  assumeNodeType,
  constructNode,
  nodeByKey,
  nodeCall,
  nodeConfigRecord,
  nodeLatest,
  nodeSelect,
  nodeWritable,
} from './runtime';

export class LexicalNode {
  declare ['constructor']: KlassConstructor<typeof LexicalNode>;
  declare __type: string;
  declare __key: string;
  declare __parent: string | null;
  declare __prev: string | null;
  declare __next: string | null;
  static importDOM?: () => DOMConversionMap | null;

  constructor(key?: string) {
    constructNode(this, new.target.getType(), key, '');
    defineNodeFields(this);
  }
  static getType(): string {
    let ownNodeType: string | undefined;
    for (const [type] of Object.entries(this.prototype.$config()))
      ownNodeType = type;
    if (ownNodeType === undefined)
      throw new Error(
        `LexicalNode: Node ${this.name} does not implement .getType().`
      );
    return ownNodeType;
  }
  static clone(_data: unknown): LexicalNode {
    throw new Error('LexicalNode.clone: must be implemented');
  }
  static importJSON(_node: SerializedLexicalNode): LexicalNode {
    throw new Error('LexicalNode.importJSON: must be implemented');
  }
  static transform(): ((node: LexicalNode) => void) | null {
    return null;
  }
  $config(): BaseStaticNodeConfig {
    return {};
  }
  config<Type extends string, Config extends StaticNodeConfigValue<this, Type>>(
    type: Type,
    config: Config
  ): BaseStaticNodeConfig & { readonly [K in Type]?: Config } {
    const parent: unknown =
      config.extends || Object.getPrototypeOf(this.constructor);
    Object.assign(config, { extends: parent, type });
    return nodeConfigRecord(type, config);
  }
  afterCloneFrom(prevNode: this): void {
    nodeCall(this, 'afterCloneFrom', [prevNode]);
  }
  resetOnCopyNodeFrom(originalNode: this): void {
    nodeCall(this, 'resetOnCopyNodeFrom', [originalNode]);
  }
  getType(): string {
    return this.__type;
  }
  getKey(): string {
    return this.__key;
  }
  getLatest(): this {
    return nodeLatest(this);
  }
  getWritable(): this {
    return nodeWritable(this);
  }
  getTextContent(): string {
    return '';
  }
  getTextContentSize(): number {
    return this.getTextContent().length;
  }
  isInline(): boolean {
    throw new Error(
      `LexicalNode: Node ${this.constructor.name} does not implement .isInline().`
    );
  }
  isAttached(): boolean {
    let node: LexicalNode | null = nodeByKey(this.__key);
    while (node !== null) {
      if (node.__key === 'root') return true;
      node = node.getParent();
    }
    return false;
  }
  isSelected(selection?: null | BaseSelection): boolean {
    const target = selection || $getSelection();
    if (target === null) return false;
    const selected = target
      .getNodes()
      .some((node) => node.getKey() === this.__key);
    if (this instanceof TextNode) return selected;
    if (
      $isRangeSelection(target) &&
      target.anchor.type === 'element' &&
      target.focus.type === 'element'
    ) {
      if (target.isCollapsed()) return false;
      const parent = this.getParent();
      if (this instanceof DecoratorNode && this.isInline() && parent !== null) {
        const first = target.isBackward() ? target.focus : target.anchor;
        if (
          parent.__key === first.key &&
          first.offset === parent.getChildrenSize() &&
          this.is(parent.getLastChild())
        )
          return false;
      }
    }
    return selected;
  }
  isDirty(): boolean {
    const dirtyLeaves = getActiveEditor()._dirtyLeaves;
    return dirtyLeaves !== null && dirtyLeaves.has(this.__key);
  }
  is(other: LexicalNode | null | undefined): boolean {
    return other != null && this.__key === other.__key;
  }
  getParent<T extends ElementNode>(): T | null {
    const key = this.getLatest().__parent;
    const node = key === null ? null : nodeByKey(key);
    if (node === null) return null;
    if (!(node instanceof ElementNode))
      throw new Error('expected parent element');
    return assumeNodeType<T>(node);
  }
  getParentOrThrow<T extends ElementNode>(): T {
    const parent = this.getParent<T>();
    if (parent === null)
      throw new Error(`Expected node ${this.__key} to have a parent.`);
    return parent;
  }
  getParents(): ElementNode[] {
    const parents: ElementNode[] = [];
    for (let node = this.getParent(); node !== null; node = node.getParent())
      parents.push(node);
    return parents;
  }
  getParentKeys(): string[] {
    return this.getParents().map((node) => node.__key);
  }
  getTopLevelElement(): ElementNode | DecoratorNode<unknown> | null {
    let node: LexicalNode | null = this;
    while (node !== null) {
      const parent: ElementNode | null = node.getParent();
      if (isRootOrShadowRoot(parent)) {
        if (
          node instanceof ElementNode ||
          (node === this && node instanceof DecoratorNode)
        )
          return node;
        throw new Error(
          'Children of root nodes must be elements or decorators'
        );
      }
      node = parent;
    }
    return null;
  }
  getTopLevelElementOrThrow(): ElementNode | DecoratorNode<unknown> {
    const node = this.getTopLevelElement();
    if (node === null)
      throw new Error(
        `Expected node ${this.__key} to have a top parent element.`
      );
    return node;
  }
  getPreviousSibling<T extends LexicalNode>(): T | null {
    const key = this.getLatest().__prev;
    const node = key === null ? null : nodeByKey(key);
    return node === null ? null : assumeNodeType<T>(node);
  }
  getNextSibling<T extends LexicalNode>(): T | null {
    const key = this.getLatest().__next;
    const node = key === null ? null : nodeByKey(key);
    return node === null ? null : assumeNodeType<T>(node);
  }
  getPreviousSiblings<T extends LexicalNode>(): T[] {
    const siblings: T[] = [];
    const parent = this.getParent();
    if (parent === null) return siblings;
    for (
      let node = parent.getFirstChild<T>();
      node !== null && !node.is(this);
      node = node.getNextSibling<T>()
    )
      siblings.push(node);
    return siblings;
  }
  getNextSiblings<T extends LexicalNode>(): T[] {
    const siblings: T[] = [];
    for (
      let node = this.getNextSibling<T>();
      node !== null;
      node = node.getNextSibling<T>()
    )
      siblings.push(node);
    return siblings;
  }
  getIndexWithinParent(): number {
    const parent = this.getParent();
    if (parent === null) return -1;
    let index = 0;
    for (
      let node = parent.getFirstChild();
      node !== null;
      node = node.getNextSibling()
    ) {
      if (this.is(node)) return index;
      index++;
    }
    return -1;
  }
  getCommonAncestor<T extends ElementNode = ElementNode>(
    node: LexicalNode
  ): T | null {
    const parents = new Set([node.__key, ...node.getParentKeys()]);
    let ancestor: ElementNode | null =
      this instanceof ElementNode ? this : this.getParent();
    while (ancestor !== null) {
      if (parents.has(ancestor.__key)) return assumeNodeType<T>(ancestor);
      ancestor = ancestor.getParent();
    }
    return null;
  }
  isParentOf(node: LexicalNode): boolean {
    return node.getParents().some((parent) => this.is(parent));
  }
  isBefore(node: LexicalNode): boolean {
    if (this.is(node)) return false;
    if (this.isParentOf(node)) return false;
    if (node.isParentOf(this)) return true;
    const common = this.getCommonAncestor(node);
    if (common === null) return false;
    let left: LexicalNode = this;
    let right: LexicalNode = node;
    while (!left.getParentOrThrow().is(common)) left = left.getParentOrThrow();
    while (!right.getParentOrThrow().is(common))
      right = right.getParentOrThrow();
    return left.getIndexWithinParent() < right.getIndexWithinParent();
  }
  getNodesBetween(targetNode: LexicalNode): LexicalNode[] {
    const before = this.isBefore(targetNode);
    const nodes: LexicalNode[] = [];
    const visited = new Set<string>();
    let node: LexicalNode | null = this;
    while (node !== null) {
      if (!visited.has(node.__key)) {
        visited.add(node.__key);
        nodes.push(node);
      }
      if (node === targetNode) break;
      const child: LexicalNode | null =
        node instanceof ElementNode
          ? before
            ? node.getFirstChild()
            : node.getLastChild()
          : null;
      if (child !== null) {
        node = child;
        continue;
      }
      const sibling: LexicalNode | null = before
        ? node.getNextSibling()
        : node.getPreviousSibling();
      if (sibling !== null) {
        node = sibling;
        continue;
      }
      const parent: ElementNode = node.getParentOrThrow();
      if (!visited.has(parent.__key)) nodes.push(parent);
      if (parent === targetNode) break;
      let ancestor: ElementNode | null = parent;
      let next: LexicalNode | null = null;
      do {
        if (ancestor === null)
          throw new Error('getNodesBetween: ancestor is null');
        next = before
          ? ancestor.getNextSibling()
          : ancestor.getPreviousSibling();
        ancestor = ancestor.getParent();
        if (ancestor === null) break;
        if (next === null && !visited.has(ancestor.__key)) nodes.push(ancestor);
      } while (next === null);
      node = next;
    }
    return before ? nodes : nodes.reverse();
  }
  insertAfter(node: LexicalNode, restoreSelection = true): LexicalNode {
    nodeCall(this, 'insertAfter', [node, restoreSelection]);
    return node;
  }
  insertBefore(node: LexicalNode, restoreSelection = true): LexicalNode {
    nodeCall(this, 'insertBefore', [node, restoreSelection]);
    return node;
  }
  replace<N extends LexicalNode>(node: N, includeChildren?: boolean): N {
    nodeCall(this, 'replace', [node, includeChildren]);
    return node.getWritable();
  }
  remove(preserveEmptyParent?: boolean): void {
    nodeCall(this, 'remove', [preserveEmptyParent]);
  }
  markDirty(): void {
    this.getWritable();
  }
  isParentRequired(): boolean {
    return false;
  }
  createParentElementNode(): ElementNode {
    return $applyNodeReplacement(new ParagraphNode());
  }
  selectStart(): RangeSelection {
    return this.selectPrevious();
  }
  selectEnd(): RangeSelection {
    return this.selectNext(0, 0);
  }
  selectPrevious(anchorOffset?: number, focusOffset?: number): RangeSelection {
    return nodeSelect(this, 'selectPrevious', [anchorOffset, focusOffset]);
  }
  selectNext(anchorOffset?: number, focusOffset?: number): RangeSelection {
    return nodeSelect(this, 'selectNext', [anchorOffset, focusOffset]);
  }
  createDOM(_config: EditorConfig, _editor: LexicalEditor): HTMLElement {
    throw new Error('createDOM: base method not extended');
  }
  updateDOM(
    _prevNode: unknown,
    _dom: HTMLElement,
    _config: EditorConfig
  ): boolean {
    throw new Error('updateDOM: base method not extended');
  }
  getDOMSlot(element: HTMLElement): DOMSlot<HTMLElement> {
    return new DOMSlot(element);
  }
  exportDOM(editor: LexicalEditor): DOMExportOutput {
    return { element: this.createDOM(editor._config, editor) };
  }
  reconcileObservedMutation(_dom: HTMLElement, _editor: LexicalEditor): void {
    this.markDirty();
  }
  exportJSON(): SerializedLexicalNode {
    return { type: this.__type, version: 1 };
  }
  updateFromJSON(
    serializedNode: LexicalUpdateJSON<SerializedLexicalNode>
  ): this {
    nodeCall(this, 'updateFromJSON', [serializedNode]);
    return this.getWritable();
  }
}
