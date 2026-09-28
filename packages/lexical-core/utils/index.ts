import { $isCodeNode } from '@lexical/code';
import { $findMatchingParent } from '@lexical/utils';
import type { LexicalNode } from 'lexical';

export * from './document';
export * from './languageSupport';
export * from './media';
export * from './mentions';
export * from './serializedNode';

export const isEmptyOrMatches = (str: string, regex: RegExp) =>
  str === '' || regex.test(str);

export const isEmptyOrEndsWithSpace = (str: string) =>
  isEmptyOrMatches(str, /\s$/);

export const isEmptyOrStartsWithSpace = (str: string) =>
  isEmptyOrMatches(str, /^\s/);

export function $isChildOfCode(node: LexicalNode) {
  const parent = $findMatchingParent(node, (node) => {
    // TODO!! : seamus - add custom code node check.
    return $isCodeNode(node);
  });
  return Boolean(parent);
}
