/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 * Licensed under the MIT license in the upstream Lexical source tree.
 */
import type {
  DOMExportOutput,
  KlassConstructor,
  LexicalUpdateJSON,
  SerializedTextNode,
  TextFormatType,
  TextModeType,
} from 'lexical';

type TextDetailType = 'directionless' | 'unmergable';

import type { DOMSlot } from '../../../lexical-wasm-view/src/compat/dom-slot';
import { $getEditor } from '../../../lexical-wasm-view/src/compat/runtime';
import type {
  CompatEditor,
  CompatEditorConfig,
} from '../../../lexical-wasm-view/src/compat/types';
import type { BaseSelection } from '../selection';
import { $getSelection, $isRangeSelection } from '../selection/helpers';
import type { RangeSelection } from '../selection/range';
import { LexicalNode } from './base';
import { type DOMConversionMap, textImportDOM } from './dom-import';
import { textFormats, toggleTextFormat } from './format';
import { ElementNode } from './index';
import { modeResult, nodeResult, nodesResult } from './results';
import { nodeCall, nodeIsComposing, nodeSelect } from './runtime';
import { createTextDOM, updateTextDOM } from './text-dom';

function textSlot(
  node: TextNode,
  config: CompatEditorConfig,
  dom: HTMLElement,
  editor?: CompatEditor
): DOMSlot<HTMLElement> {
  return config.dom === undefined
    ? node.getDOMSlot(dom)
    : config.dom.$getDOMSlot(node, dom, editor ?? $getEditor());
}

export class TextNode extends LexicalNode {
  declare ['constructor']: KlassConstructor<typeof TextNode>;
  declare __text: string;
  declare __format: number;
  declare __style: string;
  declare __mode: 0 | 1 | 2 | 3;
  declare __detail: number;
  constructor(text = '', key?: string) {
    super(key);
    this.__text = text;
  }
  static getType(): string {
    return 'text';
  }
  static importDOM(): DOMConversionMap | null {
    return textImportDOM();
  }
  static clone(node: TextNode): TextNode {
    return new TextNode(node.__text, node.__key);
  }
  afterCloneFrom(prevNode: this): void {
    super.afterCloneFrom(prevNode);
    this.__text = prevNode.__text;
    this.__format = prevNode.__format;
    this.__style = prevNode.__style;
    this.__mode = prevNode.__mode;
    this.__detail = prevNode.__detail;
  }
  static importJSON(node: SerializedTextNode): TextNode {
    return new TextNode().updateFromJSON(node);
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
  getDetail(): number {
    return this.getLatest().__detail;
  }
  getMode(): TextModeType {
    return modeResult(this.getLatest().__mode);
  }
  getStyle(): string {
    return this.getLatest().__style;
  }
  getTextContent(): string {
    return this.getLatest().__text;
  }
  getFormatFlags(type: TextFormatType, alignWithFormat: number | null): number {
    return toggleTextFormat(this.getFormat(), type, alignWithFormat);
  }
  hasFormat(type: TextFormatType): boolean {
    return (this.getFormat() & textFormats[type]) !== 0;
  }
  isToken(): boolean {
    return this.getLatest().__mode === 1;
  }
  isSegmented(): boolean {
    return this.getLatest().__mode === 2;
  }
  isDirectionless(): boolean {
    return (this.getLatest().__detail & 1) !== 0;
  }
  isUnmergeable(): boolean {
    return (this.getLatest().__detail & 2) !== 0;
  }
  isSimpleText(): boolean {
    return this.__type === 'text' && this.__mode === 0;
  }
  isComposing(): boolean {
    return nodeIsComposing(this);
  }
  isInline(): true {
    return true;
  }
  canHaveFormat(): boolean {
    return true;
  }
  canInsertTextBefore(): boolean {
    return true;
  }
  canInsertTextAfter(): boolean {
    return true;
  }
  isTextEntity(): boolean {
    return false;
  }
  setFormat(format: TextFormatType | number): this {
    const node = this.getWritable();
    node.__format = typeof format === 'string' ? textFormats[format] : format;
    return node;
  }
  setDetail(detail: TextDetailType | number): this {
    const node = this.getWritable();
    node.__detail =
      typeof detail === 'string'
        ? detail === 'directionless'
          ? 1
          : 2
        : detail;
    return node;
  }
  setStyle(style: string): this {
    const node = this.getWritable();
    node.__style = style;
    return node;
  }
  toggleFormat(type: TextFormatType): this {
    return this.setFormat(toggleTextFormat(this.getFormat(), type, null));
  }
  toggleDirectionless(): this {
    const node = this.getWritable();
    node.__detail ^= 1;
    return node;
  }
  toggleUnmergeable(): this {
    const node = this.getWritable();
    node.__detail ^= 2;
    return node;
  }
  setMode(mode: TextModeType): this {
    const value = mode === 'normal' ? 0 : mode === 'token' ? 1 : 2;
    if (this.__mode === value) return this;
    const node = this.getWritable();
    node.__mode = value;
    return node;
  }
  setTextContent(text: string): this {
    if (this.__text === text) return this;
    const node = this.getWritable();
    node.__text = text;
    return node;
  }
  select(anchorOffset?: number, focusOffset?: number): RangeSelection {
    return nodeSelect(this, 'select', [anchorOffset, focusOffset]);
  }
  selectStart(): RangeSelection {
    return this.select(0, 0);
  }
  selectEnd(): RangeSelection {
    const size = this.getTextContentSize();
    return this.select(size, size);
  }
  spliceText(
    offset: number,
    delCount: number,
    text: string,
    moveSelection?: boolean
  ): TextNode {
    const writable = this.getWritable();
    const previous = writable.__text;
    const textLength = text.length;
    let index = offset;
    if (index < 0) {
      index = textLength + index;
      if (index < 0) index = 0;
    }
    if (moveSelection) {
      const selection = $getSelection();
      if ($isRangeSelection(selection)) {
        const nextOffset = offset + textLength;
        selection.setTextNodeRange(writable, nextOffset, writable, nextOffset);
      }
    }
    writable.__text =
      previous.slice(0, index) + text + previous.slice(index + delCount);
    return writable;
  }
  splitText(...offsets: number[]): TextNode[] {
    return nodesResult(nodeCall(this, 'splitText', offsets)).map((node) => {
      if (!(node instanceof TextNode)) throw new Error('expected split text');
      return node;
    });
  }
  mergeWithSibling(target: TextNode): TextNode {
    const node = nodeResult(nodeCall(this, 'mergeWithSibling', [target]));
    if (!(node instanceof TextNode)) throw new Error('expected merged text');
    return node;
  }
  selectionTransform(
    _prevSelection: BaseSelection | null,
    _nextSelection: RangeSelection
  ): void {}
  createDOM(config: CompatEditorConfig, editor?: CompatEditor): HTMLElement {
    return createTextDOM(this, config, this.isComposing(), (dom) =>
      textSlot(this, config, dom, editor)
    );
  }
  updateDOM(prev: this, dom: HTMLElement, config: CompatEditorConfig): boolean {
    return updateTextDOM(
      this,
      prev,
      dom,
      config,
      this.isComposing(),
      (element) => textSlot(this, config, element)
    );
  }
  exportDOM(editor: CompatEditor): DOMExportOutput {
    let element = this.createDOM(editor._config, editor);
    element.style.whiteSpace = 'pre-wrap';
    if (this.hasFormat('lowercase')) element.style.textTransform = 'lowercase';
    else if (this.hasFormat('uppercase'))
      element.style.textTransform = 'uppercase';
    else if (this.hasFormat('capitalize'))
      element.style.textTransform = 'capitalize';
    const wrappers: [TextFormatType, string][] = [
      ['bold', 'b'],
      ['italic', 'i'],
      ['strikethrough', 's'],
      ['underline', 'u'],
    ];
    for (const [format, tag] of wrappers) {
      const flag = textFormats[format];
      if ((this.getFormat() & flag) !== 0) {
        const wrapper = document.createElement(tag);
        wrapper.appendChild(element);
        element = wrapper;
      }
    }
    return { element };
  }
  exportJSON(): SerializedTextNode {
    return {
      detail: this.getDetail(),
      format: this.getFormat(),
      mode: this.getMode(),
      style: this.getStyle(),
      text: this.getTextContent(),
      ...super.exportJSON(),
    };
  }
  updateFromJSON(node: LexicalUpdateJSON<SerializedTextNode>): this {
    return super
      .updateFromJSON(node)
      .setTextContent(node.text)
      .setFormat(node.format)
      .setDetail(node.detail)
      .setMode(node.mode)
      .setStyle(node.style);
  }
}
