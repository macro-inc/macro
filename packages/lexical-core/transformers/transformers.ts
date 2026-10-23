/**
 * Exports custom markdown transformers for the lexical editor.
 */

import {
  $createLinkNode,
  $isAutoLinkNode,
  $isLinkNode,
  LinkNode,
} from '@lexical/link';
import { $createMarkNode, MarkNode } from '@lexical/mark';
import type {
  ElementTransformer,
  MultilineElementTransformer,
  TextFormatTransformer,
  TextMatchTransformer,
} from '@lexical/markdown';
import {
  $createLineBreakNode,
  $createTextNode,
  $isDecoratorNode,
  $isParagraphNode,
  type LexicalNode,
  LineBreakNode,
  ParagraphNode,
} from 'lexical';
import {
  $createHorizontalRuleNode,
  $isHorizontalRuleNode,
  HorizontalRuleNode,
} from '../nodes/HorizontalRuleNode';
import {
  $createSearchMatchNode,
  SearchMatchNode,
} from '../nodes/SearchMatchNode';
import { HTML_ENTITIES } from '../utils/html-entities';
import {
  replaceTextWithUnknownMention,
  UnknownMentionNode,
} from './unknownFallback';

export function wrapXml(tag: string, attrs: Record<string, any>) {
  // JSON strings may contain a closing mention/context tag. Escaping the
  // opening bracket preserves the value without ending its markdown envelope.
  return `<${tag}>${JSON.stringify(attrs).replaceAll('<', '\\u003c')}</${tag}>`;
}

export function xmlMatcher(tag: string, flags?: string) {
  return new RegExp(`<${tag}>(.*?)<\/${tag}>`, flags ?? 's');
}

type LexicalTransformer =
  | ElementTransformer
  | MultilineElementTransformer
  | TextMatchTransformer
  | TextFormatTransformer;

export type ConversionOnlyTransformer<T extends LexicalTransformer> = T & {
  conversionOnly: true;
};

export function isConversionOnlyTransformer<T extends LexicalTransformer>(
  transformer: T
): transformer is ConversionOnlyTransformer<T> {
  return 'conversionOnly' in transformer;
}

/**
 * An empty paragraph written as a line holding a single space, so that a blank
 * line survives a markdown round trip. Internal markdown keeps this form; see
 * https://github.com/facebook/lexical/issues/4271/ for the reasoning.
 */
const EMPTY_PARAGRAPH_LINE = ' ';

/**
 * The form `protectEmptyParagraphLines` rewrites `EMPTY_PARAGRAPH_LINE` to
 * before handing markdown to Lexical. A zero-width space is not whitespace to
 * `String.prototype.trimEnd`, so Lexical's normalizer leaves it intact.
 */
const EMPTY_PARAGRAPH_SENTINEL = '\u200b';

// Mirror the fence detection in Lexical's markdown normalizer: a fence that
// opens and closes on one line leaves the surrounding block state alone.
const SINGLE_LINE_CODE_FENCE =
  /^[ \t]*```[^`]+(?:(?:`{1,2}|`{4,})[^`]+)*```(?:[^`]|$)/;
const CODE_FENCE = /^[ \t]*`{3,}/;

/**
 * Rewrite every empty-paragraph line outside fenced code to a sentinel Lexical
 * will not erase. `$convertFromMarkdownString` normalizes its input before any
 * transformer runs, and that normalizer trims trailing whitespace off every
 * line, which turns `EMPTY_PARAGRAPH_LINE` into an ordinary blank separator and
 * drops the paragraph. Inside a fence the normalizer keeps lines verbatim and a
 * lone space is content, so those are left alone.
 */
export function protectEmptyParagraphLines(markdown: string): string {
  const lines = markdown.split('\n');
  let inCodeBlock = false;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (CODE_FENCE.test(line)) {
      if (!SINGLE_LINE_CODE_FENCE.test(line)) inCodeBlock = !inCodeBlock;
      continue;
    }
    if (!inCodeBlock && line === EMPTY_PARAGRAPH_LINE) {
      lines[index] = EMPTY_PARAGRAPH_SENTINEL;
    }
  }
  return lines.join('\n');
}

export const PRESERVE_LINES: ConversionOnlyTransformer<ElementTransformer> = {
  type: 'element',
  dependencies: [ParagraphNode],
  export: (node) => {
    if ($isParagraphNode(node)) {
      const content = node.getTextContent();
      // A decorator with no text content - an await spinner, say - is still
      // a child worth exporting, not a blank line.
      if (!content.trim() && !node.getChildren().some($isDecoratorNode)) {
        return `\n${EMPTY_PARAGRAPH_LINE}\n`;
      }
    }
    return null;
  },
  // A line holding only the empty-paragraph marker, in either form.
  regExp: new RegExp(`^[${EMPTY_PARAGRAPH_LINE}${EMPTY_PARAGRAPH_SENTINEL}]$`),
  replace: (textNode, nodes, _, isImport) => {
    if (isImport && nodes.length === 1) {
      // The second empty child keeps Lexical's import from reading the
      // paragraph as a blank separator and removing it; both collapse away
      // when the editor normalizes the imported state.
      textNode.append($createTextNode(''));
    }
  },
  conversionOnly: true,
};

// Strip br tags from external markdown.
export const BR_TAG_TO_SPACE: ConversionOnlyTransformer<TextMatchTransformer> =
  {
    dependencies: [],
    export: () => {
      return null;
    },
    importRegExp: /<br\s*\/?>/i,
    regExp: /<br\s*\/?>/i,
    replace: (textNode, _) => {
      const fullText = textNode.getTextContent();
      const replacement = ' ';
      const newText = fullText.replace(/<br\s*\/?>/gi, replacement);
      if (newText !== fullText) {
        textNode.setTextContent(newText);
      }
      return textNode;
    },
    type: 'text-match',
    conversionOnly: true,
  };

export const BR_TAG_TO_LINE_BREAK: ConversionOnlyTransformer<TextMatchTransformer> =
  {
    dependencies: [LineBreakNode],
    export: () => {
      return null;
    },
    importRegExp: /<br\s*\/?>/i,
    regExp: /<br\s*\/?>/i,
    replace: (textNode, _) => {
      textNode.replace($createLineBreakNode());
    },
    type: 'text-match',
    conversionOnly: true,
  };

function createEntityToUnicodeTransformer(
  entity: string,
  unicodeChar: string
): ConversionOnlyTransformer<TextMatchTransformer> {
  const safeEntity = entity.replace(/([.*+?^=!:${}()|[\]/\\])/g, '\\$1');
  const re = new RegExp(safeEntity, 'i');
  return {
    dependencies: [],
    importRegExp: re,
    regExp: re,
    replace: (textNode) => {
      textNode.replace($createTextNode(unicodeChar));
    },
    type: 'text-match',
    conversionOnly: true,
  };
}

export const HTML_ENTITY_TRANSFORMERS = Object.entries(HTML_ENTITIES).map(
  ([entity, character]) => createEntityToUnicodeTransformer(entity, character)
);

function escapeUrl(url: string): string {
  return url.replace(/\(/g, '%28').replace(/\)/g, '%29');
}

export const LINK_XML: TextMatchTransformer = {
  dependencies: [LinkNode, UnknownMentionNode],
  export: (node: LexicalNode) => {
    if (!($isLinkNode(node) || $isAutoLinkNode(node))) return null;
    const text = node.getTextContent();
    return wrapXml('m-link', {
      url: escapeUrl(node.getURL()),
      text,
      title: node.getTitle() || '',
    });
  },
  importRegExp: xmlMatcher('m-link'),
  regExp: xmlMatcher('m-link'),
  replace: (textNode, match) => {
    try {
      const res = JSON.parse(match[1]);
      for (const field of ['url', 'text']) {
        if (!(field in res)) throw new Error(`Missing field ${field}`);
      }
      const linkNode = $createLinkNode(res.url, { title: res.title });
      const linkTextNode = $createTextNode(res.text);
      linkTextNode.setFormat(textNode.getFormat());
      linkNode.append(linkTextNode);
      textNode.replace(linkNode);
    } catch (e) {
      console.error('Error in LINK_XML replace:', e);
      replaceTextWithUnknownMention(textNode, 'Unknown Link');
    }
  },
  type: 'text-match',
};

export const MARK_XML: TextMatchTransformer = {
  dependencies: [MarkNode],
  export: (_: LexicalNode) => {
    return null;
  },
  importRegExp: xmlMatcher('mark'),
  regExp: xmlMatcher('mark'),
  replace: (textNode, match) => {
    try {
      const markNode = $createMarkNode();
      const markTextNode = $createTextNode(match[1]);
      markTextNode.setFormat(textNode.getFormat());
      markNode.append(markTextNode);
      textNode.replace(markNode);
    } catch (e) {
      console.error(e);
    }
  },
  type: 'text-match',
};

export const SEARCH_MATCH: TextMatchTransformer = {
  dependencies: [SearchMatchNode],
  export: (_: LexicalNode) => {
    return null;
  },
  importRegExp: xmlMatcher('macro_em'),
  regExp: xmlMatcher('macro_em'),
  replace: (textNode, match) => {
    try {
      const searchMatchNode = $createSearchMatchNode([]);
      const searchMatchTextNode = $createTextNode(match[1]);
      searchMatchTextNode.setFormat(textNode.getFormat());
      searchMatchNode.append(searchMatchTextNode);
      textNode.replace(searchMatchNode);
    } catch (e) {
      console.error(e);
    }
  },
  type: 'text-match',
};

export const HR: ElementTransformer = {
  dependencies: [HorizontalRuleNode],
  export: (node: LexicalNode) => {
    return $isHorizontalRuleNode(node) ? '---' : null;
  },
  regExp: /^(---|\*\*\*|___)\s?$/,
  replace: (parentNode, _1, _2, isImport) => {
    const line = $createHorizontalRuleNode();
    if (isImport || parentNode.getNextSibling() != null) {
      parentNode.replace(line);
    } else {
      parentNode.insertBefore(line);
    }
    line.selectNext();
  },
  type: 'element',
};
