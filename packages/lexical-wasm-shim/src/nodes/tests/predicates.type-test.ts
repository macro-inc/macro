import type {
  $isInlineElementOrDecoratorNode as OriginalInline,
  $isRootOrShadowRoot as OriginalRoot,
} from 'lexical';
import type { DecoratorNode, ElementNode, LexicalNode } from '../index';
import {
  $isDecoratorNode,
  $isInlineElementOrDecoratorNode,
  $isRootOrShadowRoot,
} from '../predicates';

type Guarded<Input, Narrowed extends Input> = (node: Input) => node is Narrowed;
type Target<Guard> =
  Guard extends Guarded<infer _Input, infer Narrowed> ? Narrowed : never;
type Keys<T> = T extends unknown ? Extract<keyof T, symbol> : never;
type Assert<T extends true> = T;
type Equal<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
export type ShadowKeyIdentity = Assert<
  Equal<
    Keys<Target<typeof $isRootOrShadowRoot>>,
    Keys<Target<typeof OriginalRoot>>
  >
>;
export type InlineKeyIdentity = Assert<
  Equal<
    Keys<Target<typeof $isInlineElementOrDecoratorNode>>,
    Keys<Target<typeof OriginalInline>>
  >
>;
declare const node: LexicalNode;
if ($isRootOrShadowRoot(node)) {
  const actual: ElementNode = node;
  void actual;
}
if ($isInlineElementOrDecoratorNode<number>(node)) {
  const inline: boolean = node.isInline();
  const actual: ElementNode | DecoratorNode<number> = node;
  void inline;
  void actual;
}
if ($isDecoratorNode<number>(node)) {
  const actual: DecoratorNode<number> = node;
  void actual;
}

export type RequiredInlineBrand = Assert<
  Target<typeof $isInlineElementOrDecoratorNode> extends {
    [K in Keys<Target<typeof OriginalInline>>]: never;
  }
    ? true
    : false
>;
type BrandedBranch<T> = T extends unknown
  ? Keys<T> extends never
    ? never
    : T
  : never;
export type RequiredShadowBrand = Assert<
  BrandedBranch<Target<typeof $isRootOrShadowRoot>> extends {
    [K in Keys<Target<typeof OriginalRoot>>]: never;
  }
    ? true
    : false
>;
export type ShadowKeyExists = Assert<
  [Keys<Target<typeof OriginalRoot>>] extends [never] ? false : true
>;
export type InlineKeyExists = Assert<
  [Keys<Target<typeof OriginalInline>>] extends [never] ? false : true
>;
export type ActualShadowKeyExists = Assert<
  [Keys<Target<typeof $isRootOrShadowRoot>>] extends [never] ? false : true
>;
export type ActualInlineKeyExists = Assert<
  [Keys<Target<typeof $isInlineElementOrDecoratorNode>>] extends [never]
    ? false
    : true
>;
export type ActualBaseHasNoSymbols = Assert<Equal<Keys<LexicalNode>, never>>;
