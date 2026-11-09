import type { ElementNode } from '../../nodes';
import { $setDirectionFromDOM } from '../dom-config';

declare const dom: HTMLElement;
interface SpecificElement extends ElementNode {
  readonly specificity: unique symbol;
}
declare const specific: SpecificElement;
export const sameSubtype: SpecificElement = $setDirectionFromDOM(specific, dom);
