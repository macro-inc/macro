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
  Transformer,
} from '@lexical/markdown';
import {
  $createLineBreakNode,
  $createTextNode,
  $isDecoratorNode,
  $isParagraphNode,
  $isTextNode,
  type LexicalNode,
  LineBreakNode,
  ParagraphNode,
  type TextNode,
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
import {
  $createUnlinkedTextNode,
  $isUnlinkedTextNode,
  UnlinkedTextNode,
} from '../nodes/UnlinkedTextNode';
import { findNextAutoLinkMatch } from '../utils/auto-link';
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

// Lexical's CODE import opens a fence on any line starting with three or more
// backticks and closes it at the first later line of at least as many
// backticks; a fence that never closes runs to the end. Fence lines reach it
// with trailing whitespace already trimmed.
const CODE_FENCE_START = /^[ \t]*`{3,}/;

/**
 * Rewrite every empty-paragraph line outside fenced code to a sentinel Lexical
 * will not erase. `$convertFromMarkdownString` normalizes its input before any
 * transformer runs, and that normalizer trims trailing whitespace off every
 * line, which turns `EMPTY_PARAGRAPH_LINE` into an ordinary blank separator and
 * drops the paragraph. Inside a fence a lone space is content, so those lines
 * are left alone. Only `PRESERVE_LINES` turns the sentinel back into an empty
 * paragraph, so markdown imported without it is returned unchanged.
 */
export function protectEmptyParagraphLines(
  markdown: string,
  transformers: readonly Transformer[]
): string {
  if (!transformers.includes(PRESERVE_LINES)) return markdown;
  const lines = markdown.split('\n');
  let closingFence: RegExp | undefined;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (closingFence) {
      if (closingFence.test(line.trimEnd())) closingFence = undefined;
      continue;
    }
    const fence = CODE_FENCE_START.exec(line.trimEnd())?.[0];
    if (fence !== undefined) {
      const length = fence.trim().length;
      const rest = line.trimEnd().slice(fence.length);
      // A fence that also closes on its own line is a one-line code block.
      if (!new RegExp(`\`{${length},}$`).test(rest)) {
        closingFence = new RegExp(`^[ \\t]*\`{${length},}$`);
      }
      continue;
    }
    if (line === EMPTY_PARAGRAPH_LINE) {
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

function exportUnlinkedText(
  node: TextNode,
  exportFormat: (node: TextNode, text: string) => string
): string {
  const text = node.getTextContent();
  const link = findNextAutoLinkMatch(text, 'common-tlds');
  if (!link) return exportFormat(node, text);
  return wrapXml('m-link', {
    url: link.url,
    text,
    title: '',
    unlinked: true,
    format: node.getFormat(),
  });
}

export const LINK_XML: TextMatchTransformer = {
  dependencies: [LinkNode, UnlinkedTextNode, UnknownMentionNode],
  export: (node, _exportChildren, exportFormat) => {
    if ($isUnlinkedTextNode(node))
      return exportUnlinkedText(node, exportFormat);
    if ($isAutoLinkNode(node) && node.getIsUnlinked()) {
      return node
        .getChildren()
        .filter($isTextNode)
        .map((text) => exportUnlinkedText(text, exportFormat))
        .join('');
    }
    if (!$isLinkNode(node)) return null;
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
      if (res.unlinked === true) {
        const format = typeof res.format === 'number' ? res.format : 0;
        textNode.replace(
          $createUnlinkedTextNode(res.text).setFormat(
            format | textNode.getFormat()
          )
        );
        return;
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

/** Preserve explicit unlinking when exporting to ordinary Markdown. */
export const UNLINKED_TEXT: TextMatchTransformer = {
  ...LINK_XML,
  export: (node, _exportChildren, exportFormat) => {
    if (
      !$isUnlinkedTextNode(node) &&
      !($isAutoLinkNode(node) && node.getIsUnlinked())
    )
      return null;
    const texts = $isUnlinkedTextNode(node)
      ? [node]
      : node.getChildren().filter($isTextNode);
    return texts
      .map((text) =>
        exportFormat(text, text.getTextContent()).replace(/[:.@/]/g, '\\$&')
      )
      .join('');
  },
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
