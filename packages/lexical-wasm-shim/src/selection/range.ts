/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 * Licensed under the MIT license in the upstream Lexical source tree.
 */
import { CompatOperation } from '@macro-inc/collaboration/session/compatibility.generated';
import type { TextFormatType } from 'lexical';
import type { ElementNode, LexicalNode, TextNode } from '../nodes';
import {
  booleanArgument,
  callSelection,
  nodeArrayResult,
  nodesArgument,
  numberArgument,
  textArgument,
} from './codec';
import {
  $generateNodesFromRawText,
  $getCharacterOffsets,
  $getNodesFromCaretRangeCompat,
  $getSelection,
  $setSelection,
  textFormats,
  toggleFormat,
} from './helpers';
import type { PointType } from './point';
import { $createPoint } from './point';
import type { BaseSelection } from './runtime';
import { getSelectionRuntime, isSelectionReadOnly } from './runtime';

export class RangeSelection implements BaseSelection {
  declare format: number;
  declare style: string;
  declare anchor: PointType;
  declare focus: PointType;
  declare _cachedNodes: LexicalNode[] | null;
  declare _cachedIsBackward: boolean | null;
  declare dirty: boolean;

  constructor(
    anchor: PointType,
    focus: PointType,
    format: number,
    style: string
  ) {
    this.anchor = anchor;
    this.focus = focus;
    anchor._selection = this;
    focus._selection = this;
    this._cachedNodes = null;
    this._cachedIsBackward = null;
    this.format = format;
    this.style = style;
    this.dirty = false;
  }

  getCachedNodes(): LexicalNode[] | null {
    return this._cachedNodes;
  }
  setCachedNodes(nodes: LexicalNode[] | null): void {
    this._cachedNodes = nodes;
  }
  is(selection: BaseSelection | null): boolean {
    return (
      selection instanceof RangeSelection &&
      this.anchor.is(selection.anchor) &&
      this.focus.is(selection.focus) &&
      this.format === selection.format &&
      this.style === selection.style
    );
  }
  isCollapsed(): boolean {
    return this.anchor.is(this.focus);
  }

  getNodes(): LexicalNode[] {
    if (this._cachedNodes !== null) {
      return this._cachedNodes;
    }
    const { caret } = getSelectionRuntime();
    const range = caret.$getCaretRangeInDirection(
      caret.$caretRangeFromSelection(this),
      'next'
    );
    const nodes = $getNodesFromCaretRangeCompat(range);
    if (
      process.env.NODE_ENV !== 'production' &&
      this.isCollapsed() &&
      nodes.length > 1
    ) {
      throw new Error(
        `RangeSelection.getNodes() returned ${nodes.length} > 1 nodes in a collapsed selection`
      );
    }
    if (!getSelectionRuntime().isReadOnly()) {
      this._cachedNodes = nodes;
    }
    return nodes;
  }

  setTextNodeRange(
    anchorNode: TextNode,
    anchorOffset: number,
    focusNode: TextNode,
    focusOffset: number
  ): this {
    this.anchor.set(anchorNode.__key, anchorOffset, 'text');
    this.focus.set(focusNode.__key, focusOffset, 'text');
    return this;
  }

  getTextContent(): string {
    const {
      isElementNode: $isElementNode,
      isTextNode: $isTextNode,
      isDecoratorNode: $isDecoratorNode,
      isLineBreakNode: $isLineBreakNode,
    } = getSelectionRuntime();
    const nodes = this.getNodes();
    if (nodes.length === 0) {
      return '';
    }
    const firstNode = nodes[0];
    const lastNode = nodes[nodes.length - 1];
    const anchor = this.anchor;
    const focus = this.focus;
    const isBefore = anchor.isBefore(focus);
    const [anchorOffset, focusOffset] = $getCharacterOffsets(this);
    let textContent = '';
    let prevWasElement = true;
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      if ($isElementNode(node) && !node.isInline()) {
        if (!prevWasElement) {
          textContent += '\n';
        }
        if (node.isEmpty()) {
          prevWasElement = false;
        } else {
          prevWasElement = true;
        }
      } else {
        prevWasElement = false;
        if ($isTextNode(node)) {
          let text = node.getTextContent();
          if (node === firstNode) {
            if (node === lastNode) {
              if (
                anchor.type !== 'element' ||
                focus.type !== 'element' ||
                focus.offset === anchor.offset
              ) {
                text =
                  anchorOffset < focusOffset
                    ? text.slice(anchorOffset, focusOffset)
                    : text.slice(focusOffset, anchorOffset);
              }
            } else {
              text = isBefore
                ? text.slice(anchorOffset)
                : text.slice(focusOffset);
            }
          } else if (node === lastNode) {
            text = isBefore
              ? text.slice(0, focusOffset)
              : text.slice(0, anchorOffset);
          }
          textContent += text;
        } else if (
          ($isDecoratorNode(node) || $isLineBreakNode(node)) &&
          (node !== lastNode || !this.isCollapsed())
        ) {
          textContent += node.getTextContent();
        }
      }
    }
    return textContent;
  }

  applyDOMRange(range: StaticRange): void {
    getSelectionRuntime().applyDOMRange(this, range);
  }

  clone(): RangeSelection {
    return new RangeSelection(
      $createPoint(this.anchor.key, this.anchor.offset, this.anchor.type),
      $createPoint(this.focus.key, this.focus.offset, this.focus.type),
      this.format,
      this.style
    );
  }

  toggleFormat(format: TextFormatType): void {
    this.format = toggleFormat(this.format, format);
    this.dirty = true;
  }
  setFormat(format: number): void {
    this.format = format;
    this.dirty = true;
  }
  setStyle(style: string): void {
    this.style = style;
    this.dirty = true;
  }
  hasFormat(format: TextFormatType): boolean {
    return (this.format & textFormats[format]) !== 0;
  }
  insertRawText(text: string): void {
    this.insertNodes($generateNodesFromRawText(text));
  }
  insertText(text: string): void {
    callSelection(this, CompatOperation.SelectionInsertText, [
      textArgument(text),
    ]);
  }

  removeText(): void {
    const runtime = getSelectionRuntime();
    const wasCurrent = $getSelection() === this;
    const range = runtime.caret.$removeTextFromCaretRange(
      runtime.caret.$caretRangeFromSelection(this)
    );
    runtime.caret.$updateRangeSelectionFromCaretRange(this, range);
    if (wasCurrent && $getSelection() !== this) {
      $setSelection(this);
    }
  }

  formatText(
    format: TextFormatType,
    alignWithFormat: number | null = null
  ): void {
    if (this.isCollapsed()) {
      this.toggleFormat(format);
      getSelectionRuntime().setCompositionKey(null);
      return;
    }
    const args = [textArgument(format)];
    if (alignWithFormat !== null) {
      args.push(numberArgument(alignWithFormat));
    }
    callSelection(this, CompatOperation.SelectionFormatText, args);
  }

  insertNodes(nodes: LexicalNode[]): void {
    callSelection(this, CompatOperation.SelectionInsertNodes, [
      nodesArgument(nodes),
    ]);
  }

  insertParagraph(): ElementNode | null {
    const result = callSelection(
      this,
      CompatOperation.SelectionInsertParagraph
    );
    if (
      result.data.discriminator === 1 &&
      result.data.value.value.data.discriminator === 3
    ) {
      return null;
    }
    if (result.data.discriminator !== 2) {
      throw new Error('Native paragraph insertion returned a non-node');
    }
    const runtime = getSelectionRuntime();
    const node = runtime.resolveNode(result.data.value.value);
    if (!runtime.isElementNode(node)) {
      throw new Error('Native paragraph insertion returned a non-element');
    }
    return node;
  }

  insertLineBreak(selectStart?: boolean): void {
    callSelection(
      this,
      CompatOperation.SelectionInsertLineBreak,
      selectStart === undefined ? [] : [booleanArgument(selectStart)]
    );
  }
  extract(): LexicalNode[] {
    return nodeArrayResult(
      callSelection(this, CompatOperation.SelectionExtract)
    );
  }

  modify(
    alter: 'move' | 'extend',
    isBackward: boolean,
    granularity: 'character' | 'word' | 'lineboundary'
  ): void {
    getSelectionRuntime().modifyDOMSelection(
      this,
      alter,
      isBackward,
      granularity
    );
  }

  forwardDeletion(
    anchor: PointType,
    anchorNode: TextNode | ElementNode,
    isBackward: boolean
  ): boolean {
    const runtime = getSelectionRuntime();
    if (
      !isBackward &&
      ((anchor.type === 'element' &&
        runtime.isElementNode(anchorNode) &&
        anchor.offset === anchorNode.getChildrenSize()) ||
        (anchor.type === 'text' &&
          anchor.offset === anchorNode.getTextContentSize()))
    ) {
      const parent = anchorNode.getParent();
      const next =
        anchorNode.getNextSibling() ||
        (parent === null ? null : parent.getNextSibling());
      if (runtime.isElementNode(next) && next.isShadowRoot()) {
        return true;
      }
    }
    return false;
  }

  deleteCharacter(isBackward: boolean): void {
    callSelection(this, CompatOperation.SelectionDeleteCharacter, [
      booleanArgument(isBackward),
    ]);
  }
  deleteLine(isBackward: boolean): void {
    if (this.isCollapsed()) {
      this.modify('extend', isBackward, 'lineboundary');
    }
    if (this.isCollapsed()) {
      this.deleteCharacter(isBackward);
    } else {
      this.removeText();
    }
  }
  deleteWord(isBackward: boolean): void {
    if (this.isCollapsed()) {
      if (
        this.forwardDeletion(this.anchor, this.anchor.getNode(), isBackward)
      ) {
        return;
      }
      this.modify('extend', isBackward, 'word');
    }
    if (this.isCollapsed()) {
      this.deleteCharacter(isBackward);
    } else {
      this.removeText();
    }
  }

  isBackward(): boolean {
    if (this._cachedIsBackward !== null) {
      return this._cachedIsBackward;
    }
    const result = this.focus.isBefore(this.anchor);
    if (!isSelectionReadOnly()) {
      this._cachedIsBackward = result;
    }
    return result;
  }
  getStartEndPoints(): [PointType, PointType] {
    return [this.anchor, this.focus];
  }
}
