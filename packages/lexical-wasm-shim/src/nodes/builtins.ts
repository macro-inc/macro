/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 * Licensed under the MIT license in the upstream Lexical source tree.
 */
import type {
  DOMExportOutput,
  KlassConstructor,
  SerializedLexicalNode,
  SerializedParagraphNode,
  SerializedRootNode,
} from 'lexical';

import type { LexicalEditor } from '../editor';
import type { RangeSelection } from '../selection/range';
import { LexicalNode } from './base';
import {
  type DOMConversionMap,
  lineBreakImportDOM,
  paragraphImportDOM,
} from './dom-import';
import type { EditorConfig } from './editor-config';
import { ElementNode } from './element';
import { nodeByKey } from './runtime';
import { TextNode } from './text';
import { classNames } from './text-dom';

export class ParagraphNode extends ElementNode {
  declare ['constructor']: KlassConstructor<typeof ParagraphNode>;
  static getType(): string {
    return 'paragraph';
  }
  static importDOM(): DOMConversionMap | null {
    return paragraphImportDOM();
  }
  static clone(node: ParagraphNode): ParagraphNode {
    return new ParagraphNode(node.__key);
  }
  static importJSON(node: SerializedParagraphNode): ParagraphNode {
    return new ParagraphNode().updateFromJSON(node);
  }
  createDOM(config: EditorConfig): HTMLElement {
    const dom = document.createElement('p');
    dom.classList.add(...classNames(config.theme.paragraph));
    return dom;
  }
  updateDOM(
    _prevNode: ParagraphNode,
    _dom: HTMLElement,
    _config: EditorConfig
  ): boolean {
    return false;
  }
  exportDOM(editor: LexicalEditor): DOMExportOutput {
    const { element } = super.exportDOM(editor);
    if (element instanceof HTMLElement) {
      if (this.isEmpty()) element.append(document.createElement('br'));
      const format = this.getFormatType();
      if (format !== '') element.style.textAlign = format;
    }
    return { element };
  }
  exportJSON(): SerializedParagraphNode {
    const json = super.exportJSON();
    const firstText = this.getChildren().find(
      (node) => node instanceof TextNode
    );
    return {
      ...json,
      textFormat:
        json.textFormat ?? firstText?.getFormat() ?? this.getTextFormat(),
      textStyle: json.textStyle ?? firstText?.getStyle() ?? this.getTextStyle(),
    };
  }
  insertNewAfter(
    selection: RangeSelection,
    restoreSelection: boolean
  ): ParagraphNode {
    const node = new ParagraphNode()
      .setTextFormat(selection.format)
      .setTextStyle(selection.style)
      .setDirection(this.getDirection())
      .setFormat(this.getFormatType())
      .setStyle(this.getStyle());
    this.insertAfter(node, restoreSelection);
    return node;
  }
  collapseAtStart(): boolean {
    const first = this.getFirstChild();
    if (
      first === null ||
      (first instanceof TextNode && first.getTextContent().trim() === '')
    ) {
      if (this.getNextSibling() !== null) {
        this.selectNext();
        this.remove();
        return true;
      }
      if (this.getPreviousSibling() !== null) {
        this.selectPrevious();
        this.remove();
        return true;
      }
    }
    return false;
  }
}

export class RootNode extends ElementNode {
  declare __cachedText: string | null;
  constructor() {
    super('root');
  }
  static getType(): string {
    return 'root';
  }
  static clone(): RootNode {
    return new RootNode();
  }
  static importJSON(node: SerializedRootNode): RootNode {
    const root = nodeByKey('root');
    if (!(root instanceof RootNode)) throw new Error('expected root');
    return root.updateFromJSON(node);
  }
  getTopLevelElementOrThrow(): never {
    throw new Error(
      'getTopLevelElementOrThrow: root nodes are not top level elements'
    );
  }
  remove(): never {
    throw new Error('remove: cannot be called on root nodes');
  }
  replace<N = LexicalNode>(_node: N): never {
    throw new Error('replace: cannot be called on root nodes');
  }
  insertBefore(_node: LexicalNode): LexicalNode {
    throw new Error('insertBefore: cannot be called on root nodes');
  }
  insertAfter(_node: LexicalNode): LexicalNode {
    throw new Error('insertAfter: cannot be called on root nodes');
  }
  updateDOM(_prevNode: this, _dom: HTMLElement): false {
    return false;
  }
  splice(start: number, deleteCount: number, nodes: LexicalNode[]): this {
    for (const node of nodes) {
      if (!(node instanceof ElementNode) && !(node instanceof DecoratorNode))
        throw new Error(
          'rootNode.splice: Only element or decorator nodes can be inserted to the root node'
        );
    }
    return super.splice(start, deleteCount, nodes);
  }
  collapseAtStart(): true {
    return true;
  }
}

export class LineBreakNode extends LexicalNode {
  declare ['constructor']: KlassConstructor<typeof LineBreakNode>;
  constructor(key?: string) {
    super(key);
  }
  static getType(): string {
    return 'linebreak';
  }
  static importDOM(): DOMConversionMap | null {
    return lineBreakImportDOM();
  }
  static clone(node: LineBreakNode): LineBreakNode {
    return new LineBreakNode(node.__key);
  }
  static importJSON(node: SerializedLexicalNode): LineBreakNode {
    return new LineBreakNode().updateFromJSON(node);
  }
  getTextContent(): '\n' {
    return '\n';
  }
  createDOM(): HTMLElement {
    return document.createElement('br');
  }
  updateDOM(): false {
    return false;
  }
  isInline(): true {
    return true;
  }
}

export class DecoratorNode<T> extends LexicalNode {
  declare ['constructor']: KlassConstructor<typeof DecoratorNode<T>>;
  getTopLevelElement(): ElementNode | this | null {
    const node = super.getTopLevelElement();
    if (node === this) return this;
    if (node === null || node instanceof ElementNode) return node;
    throw new Error('expected top level element or this decorator');
  }
  getTopLevelElementOrThrow(): ElementNode | this {
    const node = this.getTopLevelElement();
    if (node === null) {
      throw new Error(
        `Expected node ${this.__key} to have a top parent element.`
      );
    }
    return node;
  }
  decorate(_editor: LexicalEditor, _config: EditorConfig): T | null {
    return null;
  }
  isIsolated(): boolean {
    return false;
  }
  isInline(): boolean {
    return true;
  }
  isKeyboardSelectable(): boolean {
    return true;
  }
}
