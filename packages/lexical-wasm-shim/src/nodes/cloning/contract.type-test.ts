import type { ElementNode, LexicalNode, TextNode } from '../index';
import type { StateRecord } from '../state/record';
import { afterCloneBase, resetStateOnCopy } from './base';
import { afterCloneElementFields } from './element';
import type {
  BaseCloneField,
  CloneRuntime,
  ElementCloneField,
  TextCloneField,
} from './runtime';
import { afterCloneTextFields } from './text';

type Equal<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
export const exactBaseFields: Equal<
  BaseCloneField,
  '__parent' | '__next' | '__prev'
> = true;
export const exactElementFields: Equal<
  ElementCloneField,
  | '__first'
  | '__last'
  | '__size'
  | '__indent'
  | '__format'
  | '__style'
  | '__dir'
  | '__textFormat'
  | '__textStyle'
> = true;
export const exactTextFields: Equal<
  TextCloneField,
  '__text' | '__format' | '__style' | '__mode' | '__detail'
> = true;

declare const runtime: CloneRuntime;
declare const node: LexicalNode;
declare const previous: LexicalNode;
declare const element: ElementNode;
declare const previousElement: ElementNode;
declare const text: TextNode;
declare const previousText: TextNode;
export const rawState: StateRecord | undefined = runtime.getRawState(node);
runtime.setRawState(node, undefined);
runtime.writeBaseField(node, previous, '__parent', previous.__parent);
runtime.writeElementField(
  element,
  previousElement,
  '__dir',
  previousElement.__dir
);
runtime.writeTextField(text, previousText, '__mode', previousText.__mode);
afterCloneBase(node, previous);
afterCloneElementFields(element, previousElement);
afterCloneTextFields(text, previousText);
resetStateOnCopy(node, previous);
