import { $isCodeNode } from '@lexical/code';
import { $findMatchingParent } from '@lexical/utils';
import type {
  LexicalNode,
  RangeSelection,
  SerializedLexicalNode,
} from 'lexical';

export * from './document';
export * from './languageSupport';
export * from './media';
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

/**
 * Resets the capitalization of the selection to default.
 * Called when the user presses space, tab, or enter key.
 * @param selection The selection to reset the capitalization of.
 */
export function $resetCapitalization(selection: RangeSelection) {
  for (const format of ['lowercase', 'uppercase', 'capitalize'] as const) {
    if (selection.hasFormat(format)) {
      selection.toggleFormat(format);
    }
  }
}
