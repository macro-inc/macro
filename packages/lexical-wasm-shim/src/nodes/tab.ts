/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 * Licensed under the MIT license in the upstream Lexical source tree.
 */
import type { SerializedTextNode, TextModeType } from 'lexical';

type TextDetailType = 'directionless' | 'unmergable';

import type { DOMConversionMap } from './dom-import';
import type { EditorConfig } from './editor-config';
import { $applyNodeReplacement } from './replacement/helpers';
import { TextNode } from './text';
import { classNames } from './text-dom';

export class TabNode extends TextNode {
  constructor(key?: string) {
    super('\t', key);
  }
  static getType(): string {
    return 'tab';
  }
  static importDOM(): DOMConversionMap | null {
    return null;
  }
  static clone(node: TabNode): TabNode {
    return new TabNode(node.__key);
  }
  static importJSON(node: SerializedTextNode): TabNode {
    return $applyNodeReplacement(new TabNode()).updateFromJSON(node);
  }
  createDOM(config: EditorConfig): HTMLElement {
    const dom = super.createDOM(config);
    dom.classList.add(...classNames(config.theme.tab));
    return dom;
  }
  setTextContent(text: string): this {
    if (process.env.NODE_ENV !== 'production' && text !== '\t' && text !== '')
      throw new Error('TabNode does not support setTextContent');
    return super.setTextContent('\t');
  }
  spliceText(
    _offset: number,
    delCount: number,
    text: string,
    _moveSelection?: boolean
  ): TextNode {
    if (!((text === '' && delCount === 0) || (text === '\t' && delCount === 1)))
      throw new Error('TabNode does not support spliceText');
    return this;
  }
  setDetail(detail: TextDetailType | number): this {
    if (detail !== 2) throw new Error('TabNode does not support setDetail');
    return this;
  }
  setMode(mode: TextModeType): this {
    if (mode !== 'normal') throw new Error('TabNode does not support setMode');
    return this;
  }
  canInsertTextBefore(): boolean {
    return false;
  }
  canInsertTextAfter(): boolean {
    return false;
  }
}
