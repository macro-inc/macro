import { $isCodeNode } from '@lexical/code';
import { $findMatchingParent } from '@lexical/utils';
import type { LexicalNode, SerializedLexicalNode } from 'lexical';

export * from './document';
export * from './languageSupport';
export * from './mentions';

export function $isSerializedNode(
  node: LexicalNode | SerializedLexicalNode
): node is SerializedLexicalNode {
  return (
    typeof node === 'object' &&
    'type' in node &&
    typeof node.type === 'string' &&
    (node.$ === undefined || typeof node.$ === 'object')
  );
}

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
