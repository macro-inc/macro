import type { LexicalNodeReplacement as UpstreamReplacement } from 'lexical';
import type { LexicalNode } from '../base';
import { TextNode } from '../text';
import { bindReplacement } from './bind';
import { $applyNodeReplacement, $create } from './helpers';
import type { Klass, LexicalNodeReplacement, RegisteredNode } from './index';
import { normalizeNodeConfig, normalizeNodeConfigs } from './normalize';

declare const publicReplacement: LexicalNodeReplacement;
declare const upstreamReplacement: UpstreamReplacement;
export const publicToUpstream: UpstreamReplacement = publicReplacement;
export const upstreamToPublic: LexicalNodeReplacement = upstreamReplacement;
export const publicInvoker = bindReplacement(publicReplacement);
export const normalizedPublic = normalizeNodeConfig(publicReplacement);
export const normalizedPublicList = normalizeNodeConfigs([publicReplacement]);

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
