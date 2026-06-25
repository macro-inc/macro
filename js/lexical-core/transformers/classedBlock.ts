import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
  type ElementTransformer,
  type MultilineElementTransformer,
  TRANSFORMERS,
} from '@lexical/markdown';
import { $createQuoteNode, QuoteNode } from '@lexical/rich-text';
import type { ElementNode, LexicalNode } from 'lexical';
import {
  $createClassedBlockNode,
  $isClassedBlockNode,
  ClassedBlockNode,
} from '../nodes/ClassedBlockNode';
import { CUSTOM_TRANSFORMERS } from './customTransformers';
import { I_EQUATION_NODE } from './katex';
import {
  I_CONTACT_MENTION,
  I_DOCUMENT_MENTION,
  I_USER_MENTION,
} from './mentions';
import { xmlMatcher } from './transformers';

const TAG_MACRO_QUOTE = 'm-email-thread-embed';
const REG_EXP_XML_MACRO_QUOTE = xmlMatcher(TAG_MACRO_QUOTE, '');
const REG_EXP_HTML_BLOCKQUOTE_START = /^\s*<blockquote\b[^>]*>\s*(.*)$/i;
const REG_EXP_HTML_BLOCKQUOTE_END = /^(.*?)\s*<\/blockquote>\s*$/i;
const REG_EXP_HTML_BLOCKQUOTE_TAG = /<\/?blockquote\b[^>]*>/gi;

// Transformers used inside macro_quote blocks
const MACRO_QUOTE_TRANSFORMERS = [
  ...CUSTOM_TRANSFORMERS,
  I_EQUATION_NODE,
  I_USER_MENTION,
  I_DOCUMENT_MENTION,
  I_CONTACT_MENTION,
  ...TRANSFORMERS,
];

function htmlBlockquoteTransformers() {
  return [
    HTML_BLOCKQUOTE,
    ...CUSTOM_TRANSFORMERS,
    I_EQUATION_NODE,
    I_USER_MENTION,
    I_DOCUMENT_MENTION,
    I_CONTACT_MENTION,
    ...TRANSFORMERS,
  ];
}

function htmlBlockquoteContent(
  startMatch: Array<string>,
  endMatch: Array<string> | null,
  linesInBetween: Array<string> | null
): string {
  return [startMatch[1] ?? '', ...(linesInBetween ?? []), endMatch?.[1] ?? '']
    .join('\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .trim();
}

function consumeHtmlBlockquoteLine(
  line: string,
  startingDepth: number
): {
  closed: boolean;
  depth: number;
  text: string;
} {
  let depth = startingDepth;
  let cursor = 0;
  let text = '';
  REG_EXP_HTML_BLOCKQUOTE_TAG.lastIndex = 0;

  for (const match of line.matchAll(REG_EXP_HTML_BLOCKQUOTE_TAG)) {
    const tag = match[0];
    const index = match.index ?? 0;
    const isClosingTag = tag.startsWith('</');

    if (isClosingTag) {
      depth -= 1;
      if (depth === 0) {
        text += line.slice(cursor, index);
        return { closed: true, depth, text };
      }
      text += line.slice(cursor, index + tag.length);
      cursor = index + tag.length;
      continue;
    }

    depth += 1;
    text += line.slice(cursor, index + tag.length);
    cursor = index + tag.length;
  }

  text += line.slice(cursor);
  return { closed: false, depth, text };
}

function createHtmlBlockquoteNode(content: string): LexicalNode | false {
  const quoteNode = $createQuoteNode();
  const normalized = content.replace(/<br\s*\/?>/gi, '\n').trim();
  if (!normalized) return false;

  $convertFromMarkdownString(
    normalized,
    htmlBlockquoteTransformers(),
    quoteNode
  );
  return quoteNode;
}

function importHtmlBlockquote(
  lines: Array<string>,
  rootNode: ElementNode,
  startLineIndex: number,
  startMatch: RegExpMatchArray
): [boolean, number] | null {
  let depth = 1;
  const contentLines: string[] = [];

  for (let index = startLineIndex; index < lines.length; index++) {
    const line =
      index === startLineIndex ? (startMatch[1] ?? '') : lines[index];
    const consumed = consumeHtmlBlockquoteLine(line, depth);
    depth = consumed.depth;
    contentLines.push(consumed.text);

    if (consumed.closed) {
      const quoteNode = createHtmlBlockquoteNode(contentLines.join('\n'));
      if (!quoteNode) return null;
      rootNode.append(quoteNode);
      return [true, index];
    }
  }

  return null;
}

export const HTML_BLOCKQUOTE: MultilineElementTransformer = {
  dependencies: [QuoteNode],
  type: 'multiline-element',
  regExpStart: REG_EXP_HTML_BLOCKQUOTE_START,
  regExpEnd: REG_EXP_HTML_BLOCKQUOTE_END,
  export: () => null,
  handleImportAfterStartMatch: ({
    lines,
    rootNode,
    startLineIndex,
    startMatch,
  }) => importHtmlBlockquote(lines, rootNode, startLineIndex, startMatch),
  replace: (
    rootNode,
    children,
    startMatch,
    endMatch,
    linesInBetween,
    _isImport
  ) => {
    const quoteNode = $createQuoteNode();

    if (children?.length) {
      quoteNode.append(...children);
    } else {
      const content = htmlBlockquoteContent(
        startMatch,
        endMatch,
        linesInBetween
      );
      if (!content) return false;
      $convertFromMarkdownString(
        content,
        htmlBlockquoteTransformers(),
        quoteNode
      );
    }

    rootNode.append(quoteNode);
  },
};

export const I_MACRO_QUOTE: ElementTransformer = {
  dependencies: [ClassedBlockNode],
  type: 'element',
  regExp: REG_EXP_XML_MACRO_QUOTE,

  export: (node: LexicalNode) => {
    if (!$isClassedBlockNode(node)) {
      return null;
    }

    if (!node.__classes.includes('macro_quote')) {
      return null;
    }

    const metadata = JSON.stringify({
      tag: node.__tag,
      classes: node.__classes,
    });

    let output = `<${TAG_MACRO_QUOTE}>${metadata}`;

    // Serialize children by passing the node itself
    const childrenMarkdown = $convertToMarkdownString(
      MACRO_QUOTE_TRANSFORMERS,
      node
    );

    // Escape newlines in the content
    output += childrenMarkdown.replace(/\n/g, '\\n');
    output += `</${TAG_MACRO_QUOTE}>`;

    return output;
  },

  replace: (node, _children, match, _isImport) => {
    try {
      const xmlContent = match[0];

      // Extract the metadata and content
      const metadataMatch = xmlContent.match(
        new RegExp(`<${TAG_MACRO_QUOTE}>({.*?})`)
      );

      if (!metadataMatch || !metadataMatch[1]) {
        console.error('Error parsing macro-quote: no metadata found');
        return;
      }

      const metadata = JSON.parse(metadataMatch[1]);
      const { tag, classes } = metadata;

      // Extract content after metadata
      const contentStart = metadataMatch[0].length;
      const contentEnd = xmlContent.lastIndexOf(`</${TAG_MACRO_QUOTE}>`);
      const content = xmlContent.substring(contentStart, contentEnd);

      // Create the ClassedBlockNode
      const classedBlockNode = $createClassedBlockNode({ tag, classes });

      // Parse and append children
      $convertFromMarkdownString(
        content.replace(/\\n/g, '\n'),
        MACRO_QUOTE_TRANSFORMERS,
        classedBlockNode
      );

      node.replace(classedBlockNode);
    } catch (error) {
      console.error('Error parsing macro-quote:', error);
    }
  },
};
