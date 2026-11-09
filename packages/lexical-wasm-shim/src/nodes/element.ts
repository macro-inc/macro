/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 * Licensed under the MIT license in the upstream Lexical source tree.
 */
import type {
  DOMExportOutput,
  ElementFormatType,
  KlassConstructor,
  LexicalUpdateJSON,
  SerializedElementNode,
  TextFormatType,
} from 'lexical';

import { ElementDOMSlot } from '../../../lexical-wasm-view/src/compat/dom-slot';
import {
  getActiveEditor,
  getEditorDOMRenderConfig,
  type LexicalEditor,
} from '../editor';
import type { BaseSelection } from '../selection';
import type { RangeSelection } from '../selection/range';
import { LexicalNode } from './base';
import {
  elementFormat,
  elementFormats,
  textFormats,
  toggleTextFormat,
} from './format';
import { TextNode } from './index';
import { isRootOrShadowRoot } from './results';
import { nodeByKey, nodeCall, nodeSelect } from './runtime';

export class ElementNode extends LexicalNode {
  declare ['constructor']: KlassConstructor<typeof ElementNode>;
  constructor(key?: string) {
    super(key);
  }
  declare __first: string | null;
  declare __last: string | null;
  declare __size: number;
  declare __format: number;
  declare __style: string;
  declare __indent: number;
  declare __dir: 'ltr' | 'rtl' | null;
  declare __textFormat: number;
  declare __textStyle: string;
  afterCloneFrom(prevNode: this): void {
    super.afterCloneFrom(prevNode);
    if (this.__key === prevNode.__key) {
      this.__first = prevNode.__first;
      this.__last = prevNode.__last;
      this.__size = prevNode.__size;
    }
    this.__indent = prevNode.__indent;
    this.__format = prevNode.__format;
    this.__style = prevNode.__style;
    this.__dir = prevNode.__dir;
    this.__textFormat = prevNode.__textFormat;
    this.__textStyle = prevNode.__textStyle;
  }
  getTopLevelElement(): ElementNode | null {
    const node = super.getTopLevelElement();
    if (node !== null && !(node instanceof ElementNode))
      throw new Error('expected top level element');
    return node;
  }
  getTopLevelElementOrThrow(): ElementNode {
    const node = this.getTopLevelElement();
    if (node === null)
      throw new Error(
        `Expected node ${this.__key} to have a top parent element.`
      );
    return node;
  }
  getFormat(): number {
    return this.getLatest().__format;
  }
  getFormatType(): ElementFormatType {
    return elementFormat(this.getFormat());
  }
  getStyle(): string {
    return this.getLatest().__style;
  }
  getIndent(): number {
    return this.getLatest().__indent;
  }
  getDirection(): 'ltr' | 'rtl' | null {
    return this.getLatest().__dir;
  }
  getTextFormat(): number {
    return this.getLatest().__textFormat;
  }
  getTextStyle(): string {
    return this.getLatest().__textStyle;
  }
  hasFormat(type: ElementFormatType): boolean {
    return type !== '' && (this.getFormat() & elementFormats[type]) !== 0;
  }
  hasTextFormat(type: TextFormatType): boolean {
    return (this.getTextFormat() & textFormats[type]) !== 0;
  }
  getFormatFlags(type: TextFormatType, alignWithFormat: number | null): number {
    return toggleTextFormat(this.getTextFormat(), type, alignWithFormat);
  }
  getChildren<T extends LexicalNode>(): T[] {
    const children: T[] = [];
    for (
      let node = this.getFirstChild<T>();
      node !== null;
      node = node.getNextSibling<T>()
    )
      children.push(node);
    return children;
  }
  getChildrenKeys(): string[] {
    return this.getChildren().map((node) => node.__key);
  }
  getChildrenSize(): number {
    return this.getLatest().__size;
  }
  getFirstChild<T extends LexicalNode>(): T | null {
    const key = this.getLatest().__first;
    return key === null ? null : nodeByKey<T>(key);
  }
  getLastChild<T extends LexicalNode>(): T | null {
    const key = this.getLatest().__last;
    return key === null ? null : nodeByKey<T>(key);
  }
  getFirstChildOrThrow<T extends LexicalNode>(): T {
    const node = this.getFirstChild<T>();
    if (node === null)
      throw new Error(`Expected node ${this.__key} to have a first child.`);
    return node;
  }
  getLastChildOrThrow<T extends LexicalNode>(): T {
    const node = this.getLastChild<T>();
    if (node === null)
      throw new Error(`Expected node ${this.__key} to have a last child.`);
    return node;
  }
  getChildAtIndex<T extends LexicalNode>(index: number): T | null {
    const size = this.getChildrenSize();
    let node =
      index < size / 2 ? this.getFirstChild<T>() : this.getLastChild<T>();
    let position = index < size / 2 ? 0 : size - 1;
    while (
      node !== null &&
      (index < size / 2 ? position <= index : position >= index)
    ) {
      if (position === index) return node;
      if (index < size / 2) {
        node = node.getNextSibling<T>();
        position++;
      } else {
        node = node.getPreviousSibling<T>();
        position--;
      }
    }
    return null;
  }
  getFirstDescendant<T extends LexicalNode>(): T | null {
    let node = this.getFirstChild<T>();
    while (node instanceof ElementNode) {
      const child = node.getFirstChild<T>();
      if (child === null) break;
      node = child;
    }
    return node;
  }
  getLastDescendant<T extends LexicalNode>(): T | null {
    let node = this.getLastChild<T>();
    while (node instanceof ElementNode) {
      const child = node.getLastChild<T>();
      if (child === null) break;
      node = child;
    }
    return node;
  }
  getDescendantByIndex<T extends LexicalNode>(index: number): T | null {
    const children = this.getChildren<T>();
    const end = index >= children.length;
    const node = children[end ? children.length - 1 : index];
    return (
      (node instanceof ElementNode
        ? end
          ? node.getLastDescendant<T>()
          : node.getFirstDescendant<T>()
        : null) ||
      node ||
      null
    );
  }
  getAllTextNodes(): TextNode[] {
    const nodes: TextNode[] = [];
    for (const child of this.getChildren()) {
      if (child instanceof TextNode) nodes.push(child);
      if (child instanceof ElementNode) nodes.push(...child.getAllTextNodes());
    }
    return nodes;
  }
  getTextContent(): string {
    const children = this.getChildren();
    let text = '';
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      text += child.getTextContent();
      if (
        child instanceof ElementNode &&
        i !== children.length - 1 &&
        !child.isInline()
      )
        text += '\n\n';
    }
    return text;
  }
  getTextContentSize(): number {
    const children = this.getChildren();
    let size = 0;
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      size += child.getTextContentSize();
      if (
        child instanceof ElementNode &&
        i !== children.length - 1 &&
        !child.isInline()
      )
        size += 2;
    }
    return size;
  }
  isEmpty(): boolean {
    return this.getChildrenSize() === 0;
  }
  isDirty(): boolean {
    const dirtyElements = getActiveEditor()._dirtyElements;
    return dirtyElements !== null && dirtyElements.has(this.__key);
  }
  isLastChild(): boolean {
    return this.is(this.getParentOrThrow().getLastChild());
  }
  isInline(): boolean {
    return false;
  }
  isShadowRoot(): boolean {
    return false;
  }
  canBeEmpty(): boolean {
    return true;
  }
  canIndent(): boolean {
    return true;
  }
  canInsertTextBefore(): boolean {
    return true;
  }
  canInsertTextAfter(): boolean {
    return true;
  }
  canReplaceWith(_node: LexicalNode): boolean {
    return true;
  }
  canInsertAfter(_node: LexicalNode): boolean {
    return true;
  }
  canMergeWith(_node: ElementNode): boolean {
    return false;
  }
  canMergeWhenEmpty(): boolean {
    return false;
  }
  excludeFromCopy(_destination?: 'clone' | 'html'): boolean {
    return false;
  }
  extractWithChild(
    _child: LexicalNode,
    _selection: BaseSelection | null,
    _destination: 'clone' | 'html'
  ): boolean {
    return false;
  }
  collapseAtStart(_selection: RangeSelection): boolean {
    return false;
  }
  insertNewAfter(
    _selection: RangeSelection,
    _restoreSelection?: boolean
  ): LexicalNode | null {
    return null;
  }
  select(anchorOffset?: number, focusOffset?: number): RangeSelection {
    return nodeSelect(this, 'select', [anchorOffset, focusOffset]);
  }
  selectStart(): RangeSelection {
    const first = this.getFirstDescendant();
    return first === null ? this.select() : first.selectStart();
  }
  selectEnd(): RangeSelection {
    const last = this.getLastDescendant();
    return last === null ? this.select() : last.selectEnd();
  }
  clear(): this {
    nodeCall(this, 'clear', []);
    return this.getWritable();
  }
  append(...nodes: LexicalNode[]): this {
    return this.splice(this.getChildrenSize(), 0, nodes);
  }
  splice(
    start: number,
    deleteCount: number,
    nodesToInsert: LexicalNode[]
  ): this {
    nodeCall(this, 'splice', [start, deleteCount, nodesToInsert]);
    return this.getWritable();
  }
  setDirection(direction: 'ltr' | 'rtl' | null): this {
    const node = this.getWritable();
    node.__dir = direction;
    return node;
  }
  setFormat(type: ElementFormatType): this {
    const node = this.getWritable();
    node.__format = elementFormats[type] || 0;
    return this;
  }
  setStyle(style: string): this {
    const node = this.getWritable();
    node.__style = style || '';
    return this;
  }
  setTextFormat(format: number): this {
    const node = this.getWritable();
    node.__textFormat = format;
    return node;
  }
  setTextStyle(style: string): this {
    const node = this.getWritable();
    node.__textStyle = style;
    return node;
  }
  setIndent(indent: number): this {
    const node = this.getWritable();
    node.__indent = indent;
    return this;
  }
  getDOMSlot(element: HTMLElement): ElementDOMSlot<HTMLElement> {
    return new ElementDOMSlot(element);
  }
  exportDOM(editor: LexicalEditor): DOMExportOutput {
    const { element } = super.exportDOM(editor);
    if (element instanceof HTMLElement) {
      const indent = this.getIndent();
      if (indent > 0) {
        element.style.paddingInlineStart = `${indent * 40}px`;
        element.setAttribute('data-lexical-indent', String(indent));
      }
      const direction = this.getDirection();
      if (direction !== null) element.dir = direction;
    }
    return { element };
  }
  reconcileObservedMutation(dom: HTMLElement, editor: LexicalEditor): void {
    const slot = getEditorDOMRenderConfig(editor).$getDOMSlot(
      this,
      dom,
      editor
    );
    let current = slot.getFirstChild();
    for (const child of this.getChildren()) {
      const correct = editor.getElementByKey(child.__key);
      if (correct === null) continue;
      if (current === null) {
        slot.insertChild(correct);
        current = correct;
      } else if (current !== correct) slot.replaceChild(correct, current);
      current = current.nextSibling;
    }
  }
  exportJSON(): SerializedElementNode {
    const json: SerializedElementNode = {
      children: [],
      direction: this.getDirection(),
      format: this.getFormatType(),
      indent: this.getIndent(),
      ...super.exportJSON(),
    };
    if (
      (this.getTextFormat() !== 0 || this.getTextStyle() !== '') &&
      !isRootOrShadowRoot(this) &&
      !this.getChildren().some((node) => node instanceof TextNode)
    ) {
      if (this.getTextFormat() !== 0) json.textFormat = this.getTextFormat();
      if (this.getTextStyle() !== '') json.textStyle = this.getTextStyle();
    }
    return json;
  }
  updateFromJSON(node: LexicalUpdateJSON<SerializedElementNode>): this {
    return super
      .updateFromJSON(node)
      .setFormat(node.format)
      .setIndent(node.indent)
      .setDirection(node.direction)
      .setTextFormat(node.textFormat || 0)
      .setTextStyle(node.textStyle || '');
  }
}
