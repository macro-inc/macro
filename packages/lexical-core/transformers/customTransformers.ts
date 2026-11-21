import { $isLinkNode } from '@lexical/link';
import { $isListNode } from '@lexical/list';
import {
  CHECK_LIST,
  type ElementTransformer,
  LINK,
  ORDERED_LIST,
  type TextMatchTransformer,
  TRANSFORMERS,
  type Transformer,
  UNORDERED_LIST,
} from '@lexical/markdown';
import { $isHeadingNode } from '@lexical/rich-text';
import { $unwrapNode } from '@lexical/utils';
import { $isElementNode, type ElementNode, type LexicalNode } from 'lexical';
import { isAllowedLinkUrl } from '../utils/link-url';
import { HTML_TEXT_FORMAT_TRANSFORMERS } from './htmlTextFormats';

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
      if (original === ORDERED_LIST) {
        const nextNode = parentNode.getNextSibling();
        const start = Number(match[2]);

        if (
          Number.isFinite(start) &&
          $isListNode(nextNode) &&
          nextNode.getListType() === 'number'
        ) {
          nextNode.setStart(start);
        }
      }
      original.replace(parentNode, children, match, isImport);
    },
  };
};

const orderedListTransformer = customTransformer(ORDERED_LIST);

/** Enter on `6.` (no trailing space) still starts an ordered list at 6. */
export const ORDERED_LIST_ENTER: ElementTransformer = {
  ...orderedListTransformer,
  regExp: /^(\s*)(\d{1,})\.$/,
};

/**
 * Lexical's `[text](url)` link, kept as its text when the URL is one a link may
 * not open, such as `javascript:`. The URL is checked after Lexical has
 * unescaped it, as the link would hold it.
 */
const MARKDOWN_LINK: TextMatchTransformer = {
  ...LINK,
  replace: (textNode, match) => {
    const linkTextNode = LINK.replace?.(textNode, match);
    if (!linkTextNode) return linkTextNode;
    const linkNode = linkTextNode.getParent();
    if ($isLinkNode(linkNode) && !isAllowedLinkUrl(linkNode.getURL())) {
      $unwrapNode(linkNode);
    }
    return linkTextNode;
  },
};

/** Lexical's own Markdown transformers; use these instead of its `TRANSFORMERS`. */
export const STANDARD_TRANSFORMERS: Transformer[] = TRANSFORMERS.map((t) =>
  t === LINK ? MARKDOWN_LINK : t
);

export const CUSTOM_TRANSFORMERS: Transformer[] = [
  ...HTML_TEXT_FORMAT_TRANSFORMERS,
  ...STANDARD_TRANSFORMERS.filter((t) => {
    return t !== CHECK_LIST && t !== ORDERED_LIST && t !== UNORDERED_LIST;
  }),
  orderedListTransformer,
  customTransformer(CHECK_LIST),
  customTransformer(UNORDERED_LIST),
];
