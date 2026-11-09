/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 * Licensed under the MIT license in the upstream Lexical source tree.
 */
import type { LexicalNode } from './index';

export type DOMConversionProp<T extends HTMLElement> = (
  node: T
) => DOMConversion<T> | null;
export type DOMConversion<T extends HTMLElement = HTMLElement> = {
  conversion: DOMConversionFn<T>;
  priority?: 0 | 1 | 2 | 3 | 4;
};
export type DOMConversionFn<T extends HTMLElement = HTMLElement> = (
  element: T
) => DOMConversionOutput | null;
export type DOMChildConversion = (
  lexicalNode: LexicalNode,
  parentLexicalNode: LexicalNode | null | undefined
) => LexicalNode | null | undefined;
export type DOMConversionMap<T extends HTMLElement = HTMLElement> = Record<
  string,
  DOMConversionProp<T>
>;
export type DOMConversionOutput = {
  after?: (nodes: LexicalNode[]) => LexicalNode[];
  forChild?: DOMChildConversion;
  node: null | LexicalNode | LexicalNode[];
};

export type DOMConversionPropByTagName<K extends string> = DOMConversionProp<
  K extends keyof HTMLElementTagNameMap ? HTMLElementTagNameMap[K] : HTMLElement
>;
export type DOMConversionTagNameMap<K extends string> = {
  [NodeName in K]?: DOMConversionPropByTagName<NodeName>;
};
