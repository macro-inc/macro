import type { ElementNode, LexicalNode, TextNode } from '../nodes';
import { $getCaretInDirection, $getCaretRangeInDirection } from './direction';
import {
  $getChildCaret,
  $getSiblingCaret,
  $getTextPointCaret,
  flipDirection,
} from './node-carets';
import type {
  CaretDirection,
  CaretRange,
  ChildCaret,
  FlipDirection,
  NodeCaret,
  PointCaret,
  SiblingCaret,
  TextPointCaret,
} from './types';

interface ActualText extends TextNode {
  readonly actualTextIdentity: unique symbol;
}
interface ActualElement extends ElementNode {
  readonly actualElementIdentity: unique symbol;
}
declare const text: ActualText;
declare const element: ActualElement;
declare const node: LexicalNode;
declare const ordinaryText: TextNode;
declare const nullable: ActualText | null;
declare const range: CaretRange<CaretDirection>;
export const textOrigin: TextPointCaret<ActualText, 'next'> =
  $getTextPointCaret(text, 'next', 0);
export const elementOrigin: ChildCaret<ActualElement, 'previous'> =
  $getChildCaret(element, 'previous');
export const siblingOrigin: SiblingCaret<ActualText, 'next'> = $getSiblingCaret(
  text,
  'next'
);
export const nullableOrigin: TextPointCaret<ActualText, 'next'> | null =
  $getTextPointCaret(nullable, 'next', 0);
export const flippedText: TextPointCaret<ActualText, 'previous'> =
  textOrigin.getFlipped();
export const flippedNode: NodeCaret<'next'> = elementOrigin.getFlipped();
export const flippedRange: CaretRange<'next'> = $getCaretRangeInDirection(
  range,
  'next'
);
export const conditionalText:
  | NodeCaret<'previous'>
  | TextPointCaret<TextNode, 'previous'> = $getCaretInDirection(
  textOrigin,
  'previous'
);
export const conditionalSibling: NodeCaret<'previous'> = $getCaretInDirection(
  siblingOrigin,
  'previous'
);
export function conditionalFlipDirection<D extends CaretDirection>(
  direction: D
): FlipDirection<D> {
  return flipDirection(direction);
}
export function genericFactory<T extends TextNode, D extends CaretDirection>(
  origin: T,
  direction: D
): TextPointCaret<T, D> {
  return $getTextPointCaret(origin, direction, 0);
}
export function genericDirection<
  Caret extends PointCaret,
  D extends CaretDirection,
>(
  caret: Caret,
  direction: D
):
  | NodeCaret<D>
  | (Caret extends TextPointCaret<TextNode, CaretDirection>
      ? TextPointCaret<TextNode, D>
      : never) {
  return $getCaretInDirection(caret, direction);
}
// @ts-expect-error Base nodes cannot become text-point origins.
$getTextPointCaret(node, 'next', 0);
// @ts-expect-error Direction changes must be explicit.
export const wrongDirection: TextPointCaret<ActualText, 'previous'> =
  textOrigin;
// @ts-expect-error A generic text node does not promise the actual subtype marker.
export const missingSubtype: TextPointCaret<ActualText, 'next'> =
  $getTextPointCaret(ordinaryText, 'next', 0);
