import {
  CHECK_LIST,
  type ElementTransformer,
  ORDERED_LIST,
  TRANSFORMERS,
  type Transformer,
  UNORDERED_LIST,
} from '@lexical/markdown';
import { $isHeadingNode } from '@lexical/rich-text';
import { $isElementNode, type ElementNode, type LexicalNode } from 'lexical';

const customTransformer = (
  original: ElementTransformer
): ElementTransformer => {
  return {
    ...original,
    replace: (
      parentNode: ElementNode,
      children: LexicalNode[],
      match: string[],
      isImport: boolean
    ): false | void => {
      if (
        parentNode &&
        $isElementNode(parentNode) &&
        $isHeadingNode(parentNode)
      ) {
        return false;
      }
      original.replace(parentNode, children, match, isImport);
    },
  };
};

export const CUSTOM_TRANSFORMERS: Transformer[] = [
  ...TRANSFORMERS.filter((t) => {
    return t !== CHECK_LIST && t !== ORDERED_LIST && t !== UNORDERED_LIST;
  }),
  customTransformer(ORDERED_LIST),
  customTransformer(CHECK_LIST),
  customTransformer(UNORDERED_LIST),
];
