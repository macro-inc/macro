import type { LexicalNode } from '../base';
import { TextNode } from '../text';
import { bindReplacement } from './bind';
import { $applyNodeReplacement, $create } from './helpers';
import type { Klass, RegisteredNode } from './types';

class CustomText extends TextNode {
  customField = true;
}
declare const custom: CustomText;
export const applied: CustomText = $applyNodeReplacement(custom);
export const created: CustomText = $create(CustomText);
export const klass: Klass<CustomText> = CustomText;
export const bound = bindReplacement({
  replace: CustomText,
  with: (node: CustomText): LexicalNode => node.setTextContent('replaced'),
});
declare const registered: RegisteredNode;
export const registeredClass: LexicalNode['constructor'] = registered.klass;
export const transform: Set<(node: LexicalNode) => void> =
  registered.transforms;
