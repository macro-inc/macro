import type { BaseStaticNodeConfig, StaticNodeConfigValue } from './config';
import {
  type ElementNode,
  type LexicalNode,
  type ParagraphNode,
  TextNode,
} from './index';

declare const text: TextNode;
declare const element: ElementNode;
declare const paragraph: ParagraphNode;

export const parent: ParagraphNode | null = text.getParent<ParagraphNode>();
export const parentOrThrow: ParagraphNode =
  text.getParentOrThrow<ParagraphNode>();
export const children: TextNode[] = element.getChildren<TextNode>();
export const first: TextNode | null = element.getFirstChild<TextNode>();
export const last: TextNode = element.getLastChildOrThrow<TextNode>();
export const descendants: TextNode | null =
  element.getFirstDescendant<TextNode>();
export const sibling: ParagraphNode | null =
  paragraph.getNextSibling<ParagraphNode>();
export const common: ElementNode | null =
  paragraph.getCommonAncestor<ElementNode>(text);
export const replacement: ParagraphNode = text.replace(paragraph);

declare class CustomText extends TextNode {
  customValue: string;
}
declare const custom: CustomText;
export const latest: CustomText = custom.getLatest();
export const writable: CustomText = custom.getWritable();
export const mutation: CustomText = custom
  .setTextContent('text')
  .toggleFormat('bold');

export type CallerAssertedLookup = <T extends ElementNode>() => T | null;
export const exactParentSignature: CallerAssertedLookup = text.getParent;
export type CallerAssertedChildren = <T extends LexicalNode>() => T[];
export const exactChildrenSignature: CallerAssertedChildren =
  element.getChildren;

export const configured = custom.config('custom-text', {
  extends: TextNode,
  $transform: (node: CustomText) => {
    node.customValue = 'changed';
  },
});
export const configuredAsBase: BaseStaticNodeConfig = configured;
export const configuredWithSelf:
  | StaticNodeConfigValue<CustomText, 'custom-text'>
  | undefined = configured['custom-text'];
