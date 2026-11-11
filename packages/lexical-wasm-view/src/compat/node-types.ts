/** DOM-consumed graph and hooks; public facade completeness is checked separately. */
import type { NodeKey } from 'lexical';
import type { CompatRangeSelection } from './types';

export interface CompatNode {
  __key: string;
  __next: null | NodeKey;
  __parent: null | NodeKey;
  __prev: null | NodeKey;
  __type: string;
  getIndexWithinParent(): number;
  getKey(): NodeKey;
  getLatest(): this;
  getNextSibling(): CompatNode | null;
  getParent(): CompatElementNode | null;
  getParentOrThrow(): CompatElementNode;
  getPreviousSibling(): CompatNode | null;
  getTextContent(): string;
  getTextContentSize(): number;
  getType(): string;
  getWritable(): this;
  isAttached(): boolean;
  isDirty(): boolean;
  markDirty(): void;
  remove(preserveEmptyParent?: boolean): void;
  selectEnd(): CompatRangeSelection;
}

export interface CompatElementNode extends CompatNode {
  getTopLevelElementOrThrow(): CompatElementNode;
  __dir: 'ltr' | 'rtl' | null;
  __first: null | NodeKey;
  __format: number;
  __indent: number;
  __last: null | NodeKey;
  __size: number;
  __textFormat: number;
  __textStyle: string;
  canBeEmpty(): boolean;
  canInsertTextAfter(): boolean;
  canInsertTextBefore(): boolean;
  getChildAtIndex(index: number): CompatNode | null;
  getChildren(): CompatNode[];
  getChildrenSize(): number;
  getFirstDescendant(): CompatNode | null;
  getFormat(): number;
  getLastDescendant(): CompatNode | null;
  getStyle(): string;
  getTextContent(): string;
  getTextContentSize(): number;
  getTextFormat(): number;
  getTextStyle(): string;
  isEmpty(): boolean;
  isInline(): boolean;
  isShadowRoot(): boolean;
  selectEnd(): CompatRangeSelection;
  selectStart(): CompatRangeSelection;
  setTextFormat(type: number): this;
  setTextStyle(style: string): this;
}

export interface CompatTextNode extends CompatNode {
  getTopLevelElementOrThrow(): CompatElementNode;
  __text: string;
  canInsertTextAfter(): boolean;
  canInsertTextBefore(): boolean;
  getFormat(): number;
  getStyle(): string;
  getTextContent(): string;
  isComposing(): boolean;
  isSegmented(): boolean;
  isToken(): boolean;
  select(_anchorOffset?: number, _focusOffset?: number): CompatRangeSelection;
  selectEnd(): CompatRangeSelection;
  setTextContent(text: string): this;
}

export interface CompatDecoratorNode extends CompatNode {
  isInline(): boolean;
  isIsolated(): boolean;
  isKeyboardSelectable(): boolean;
}

export interface CompatRootNode extends CompatElementNode {
  __cachedText: null | string;
  getTextContent(): string;
}

export interface CompatLineBreakNode extends CompatNode {
  getTextContent(): '\n';
}
export type CompatTabNode = CompatTextNode;
