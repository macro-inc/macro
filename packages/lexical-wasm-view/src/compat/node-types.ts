/** DOM-consumed graph and hooks; public facade completeness is checked separately. */
import type { NodeKey } from 'lexical';
import type {
  CompatEditor,
  CompatEditorConfig,
  CompatRangeSelection,
} from './types';

export interface CompatNode {
  __key: string;
  __next: null | NodeKey;
  __parent: null | NodeKey;
  __prev: null | NodeKey;
  __type: string;
  getIndexWithinParent(): number;
  getTopLevelElementOrThrow(): CompatElementNode | CompatDecoratorNode<unknown>;
  getKey(): NodeKey;
  getLatest(): this;
  getNextSibling<T extends CompatNode>(): T | null;
  getParent<T extends CompatElementNode>(): T | null;
  getParentOrThrow<T extends CompatElementNode>(): T;
  getPreviousSibling<T extends CompatNode>(): T | null;
  getTextContent(): string;
  getTextContentSize(): number;
  getType(): string;
  getWritable(): this;
  is(object: CompatNode | null | undefined): boolean;
  isAttached(): boolean;
  isDirty(): boolean;
  markDirty(): void;
  reconcileObservedMutation(dom: HTMLElement, editor: CompatEditor): void;
  remove(preserveEmptyParent?: boolean): void;
  replace<N extends CompatNode>(replaceWith: N, includeChildren?: boolean): N;
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
  getChildAtIndex<T extends CompatNode>(index: number): null | T;
  getChildren<T extends CompatNode>(): Array<T>;
  getChildrenSize(): number;
  getFirstDescendant<T extends CompatNode>(): null | T;
  getFormat(): number;
  getLastDescendant<T extends CompatNode>(): null | T;
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

export interface CompatDecoratorNode<T> extends CompatNode {
  decorate(editor: CompatEditor, config: CompatEditorConfig): null | T;
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
  isInline(): true;
}
export interface CompatTabNode extends CompatTextNode {
  spliceText(
    offset: number,
    delCount: number,
    newText: string,
    moveSelection?: boolean
  ): CompatTextNode;
  setDetail(detail: 'directionless' | 'unmergable' | number): this;
  setMode(type: import('lexical').TextModeType): this;
}
