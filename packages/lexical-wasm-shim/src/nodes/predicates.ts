/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 * Licensed under the MIT license in the repository root.
 * Ported from pinned lexical v0.45.0.
 */
import type {
  $isInlineElementOrDecoratorNode as OriginalInlinePredicate,
  $isRootOrShadowRoot as OriginalRootPredicate,
} from 'lexical';
import {
  DecoratorNode,
  ElementNode,
  LexicalNode,
  LineBreakNode,
  RootNode,
  TabNode,
  TextNode,
} from './index';

type Guarded<Input, Narrowed extends Input> = (node: Input) => node is Narrowed;
type PredicateTarget<Guard> =
  Guard extends Guarded<infer _Input, infer Narrowed> ? Narrowed : never;
type SymbolKeys<T> = T extends unknown ? Extract<keyof T, symbol> : never;
type BaseSymbolKeys = SymbolKeys<LexicalNode>;
type ShadowBrand = Exclude<
  SymbolKeys<PredicateTarget<typeof OriginalRootPredicate>>,
  BaseSymbolKeys
>;
type InlineBrand = Exclude<
  SymbolKeys<PredicateTarget<typeof OriginalInlinePredicate>>,
  BaseSymbolKeys
>;
type ShadowRootNode = Omit<ElementNode, 'isShadowRoot'> & {
  isShadowRoot(): true;
} & { [K in ShadowBrand]: never };

function $isTextNode(node: LexicalNode | null | undefined): node is TextNode {
  return node instanceof TextNode;
}
function $isLineBreakNode(
  node: LexicalNode | null | undefined
): node is LineBreakNode {
  return node instanceof LineBreakNode;
}
function $isElementNode(
  node: LexicalNode | null | undefined
): node is ElementNode {
  return node instanceof ElementNode;
}
export function $isLexicalNode(
  node: LexicalNode | null | undefined
): node is LexicalNode {
  return node instanceof LexicalNode;
}
export function $isRootNode(
  node: RootNode | LexicalNode | null | undefined
): node is RootNode {
  return node instanceof RootNode;
}
export function $isTabNode(
  node: LexicalNode | null | undefined
): node is TabNode {
  return node instanceof TabNode;
}
export function $isDecoratorNode<T>(
  node: LexicalNode | null | undefined
): node is DecoratorNode<T> {
  return node instanceof DecoratorNode;
}

export function $isLeafNode(
  node: LexicalNode | null | undefined
): node is TextNode | LineBreakNode | DecoratorNode<unknown> {
  return $isTextNode(node) || $isLineBreakNode(node) || $isDecoratorNode(node);
}

export function $isTokenOrSegmented(node: TextNode): boolean {
  return $isTokenOrTab(node) || node.isSegmented();
}

export function $isTokenOrTab(node: TextNode): boolean {
  return $isTabNode(node) || node.isToken();
}

export function $isRootOrShadowRoot(
  node: null | LexicalNode
): node is RootNode | ShadowRootNode {
  return $isRootNode(node) || ($isElementNode(node) && node.isShadowRoot());
}

export function $isInlineElementOrDecoratorNode<T>(node: LexicalNode): node is (
  | ElementNode
  | DecoratorNode<T>
) & { isInline(): true } & {
  [K in InlineBrand]: never;
} {
  return (
    ($isElementNode(node) && node.isInline()) ||
    ($isDecoratorNode(node) && node.isInline())
  );
}
