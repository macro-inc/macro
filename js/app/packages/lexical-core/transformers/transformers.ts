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
  TextMatchTransformer,
} from '@lexical/markdown';
import {
  $createLineBreakNode,
  $createTextNode,
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

export function wrapXml(tag: string, attrs: Record<string, any>) {
  return `<${tag}>${JSON.stringify(attrs)}</${tag}>`;
}

export function xmlMatcher(tag: string, flags?: string) {
  return new RegExp(`<${tag}>(.*?)<\/${tag}>`, flags ?? 's');
}

// See https://github.com/facebook/lexical/issues/4271/ for the reasoning behind this.
export const PRESERVE_LINES: ElementTransformer = {
  type: 'element',
  dependencies: [ParagraphNode],
  export: (node) => {
    if ($isParagraphNode(node)) {
      const content = node.getTextContent();
      if (!content.trim()) {
        return '\n \n';
      }
    }
    return null;
  },
  regExp: /^ $/, // a line with only a space
  replace: (textNode, nodes, _, isImport) => {
    if (isImport && nodes.length === 1) {
      textNode.append($createTextNode(''));
    }
  },
};

// Strip br tags from external markdown.
export const BR_TAG_TO_SPACE: TextMatchTransformer = {
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
};

export const BR_TAG_TO_LINE_BREAK: TextMatchTransformer = {
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
};

function createEntityToUnicodeTransformer(
  entity: string,
  unicodeChar: string
): TextMatchTransformer {
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
  };
}

export const AMP_ENTITY_TRANSFORMER = createEntityToUnicodeTransformer(
  '&amp;',
  '&'
);
export const NBSP_ENTITY_TRANSFORMER = createEntityToUnicodeTransformer(
  '&nbsp;',
  '\u00A0'
);
export const LT_ENTITY_TRANSFORMER = createEntityToUnicodeTransformer(
  '&lt;',
  '<'
);
export const GT_ENTITY_TRANSFORMER = createEntityToUnicodeTransformer(
  '&gt;',
  '>'
);
export const COPY_ENTITY_TRANSFORMER = createEntityToUnicodeTransformer(
  '&copy;',
  '©'
);
export const REG_ENTITY_TRANSFORMER = createEntityToUnicodeTransformer(
  '&reg;',
  '®'
);
export const TRADE_ENTITY_TRANSFORMER = createEntityToUnicodeTransformer(
  '&trade;',
  '™'
);

export const HTML_ENTITY_TRANSFORMERS = [
  AMP_ENTITY_TRANSFORMER,
  NBSP_ENTITY_TRANSFORMER,
  LT_ENTITY_TRANSFORMER,
  GT_ENTITY_TRANSFORMER,
  COPY_ENTITY_TRANSFORMER,
  REG_ENTITY_TRANSFORMER,
  TRADE_ENTITY_TRANSFORMER,
];

function escapeUrl(url: string): string {
  return url.replace(/\(/g, '%28').replace(/\)/g, '%29');
}

export const LINK_XML: TextMatchTransformer = {
  dependencies: [LinkNode],
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
      console.error(e);
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
  importRegExp: xmlMatcher('macro-em'),
  regExp: xmlMatcher('macro-em'),
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
