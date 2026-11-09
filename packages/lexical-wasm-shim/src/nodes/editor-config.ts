/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 * Licensed under the MIT license in the upstream Lexical source tree.
 */
import type { DOMExportOutput, EditorThemeClasses } from 'lexical';
import type {
  DOMSlot,
  ElementDOMSlot,
} from '../../../lexical-wasm-view/src/compat/dom-slot';
import type { LexicalEditor } from '../editor';
import type { BaseSelection } from '../selection';
import type { ElementNode, LexicalNode } from './index';

export interface EditorConfig {
  dom?: EditorDOMRenderConfig;
  disableEvents?: boolean;
  namespace: string;
  theme: EditorThemeClasses;
}

export type DOMSlotForNode<N extends LexicalNode> = N extends ElementNode
  ? ElementDOMSlot<HTMLElement>
  : DOMSlot<HTMLElement>;

export interface EditorDOMRenderConfig {
  $createDOM: <T extends LexicalNode>(
    node: T,
    editor: LexicalEditor
  ) => HTMLElement;
  $getDOMSlot: <N extends LexicalNode>(
    node: N,
    dom: HTMLElement,
    editor: LexicalEditor
  ) => DOMSlotForNode<N>;
  $exportDOM: <T extends LexicalNode>(
    node: T,
    editor: LexicalEditor
  ) => DOMExportOutput;
  $extractWithChild: <T extends LexicalNode>(
    node: T,
    childNode: LexicalNode,
    selection: BaseSelection | null,
    destination: 'clone' | 'html',
    editor: LexicalEditor
  ) => boolean;
  $decorateDOM: <T extends LexicalNode>(
    node: T,
    prevNode: T | null,
    dom: HTMLElement,
    editor: LexicalEditor
  ) => void;
  $updateDOM: <T extends LexicalNode>(
    nextNode: T,
    prevNode: T,
    dom: HTMLElement,
    editor: LexicalEditor
  ) => boolean;
  $shouldInclude: <T extends LexicalNode>(
    node: T,
    selection: BaseSelection | null,
    editor: LexicalEditor
  ) => boolean;
  $shouldExclude: <T extends LexicalNode>(
    node: T,
    selection: BaseSelection | null,
    editor: LexicalEditor
  ) => boolean;
}
