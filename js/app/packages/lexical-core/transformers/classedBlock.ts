import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
  type ElementTransformer,
  TRANSFORMERS,
} from '@lexical/markdown';
import type { LexicalNode } from 'lexical';
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

// Transformers used inside macro_quote blocks
const MACRO_QUOTE_TRANSFORMERS = [
  ...CUSTOM_TRANSFORMERS,
  I_EQUATION_NODE,
  I_USER_MENTION,
  I_DOCUMENT_MENTION,
  I_CONTACT_MENTION,
  ...TRANSFORMERS,
];

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
