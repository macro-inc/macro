import type { ElementTransformer } from '@lexical/markdown';
import type { ElementNode, LexicalNode } from 'lexical';
import {
  $createQuoteReplyNode,
  $isQuoteReplyNode,
  buildQuoteReplyMarkdown,
  isQuoteReplyData,
  QuoteReplyNode,
} from '../nodes/QuoteReplyNode';
import {
  replaceElementWithUnknownMention,
  UnknownMentionNode,
} from './unknownFallback';

/** Internal Markdown transformer for channel quote-reply references. */
export const I_QUOTE_REPLY_NODE: ElementTransformer = {
  dependencies: [QuoteReplyNode, UnknownMentionNode],
  type: 'element',
  regExp: /^<m-quote-reply>(.*?)<\/m-quote-reply>$/s,
  export: (node: LexicalNode) => {
    if (!$isQuoteReplyNode(node)) return null;
    return buildQuoteReplyMarkdown(node.exportComponentProps());
  },
  replace: (parent: ElementNode, _, match: string[]) => {
    try {
      const data: unknown = JSON.parse(match[1] ?? '');
      if (!isQuoteReplyData(data)) {
        throw new Error('invalid quote-reply data');
      }
      parent.replace($createQuoteReplyNode(data));
    } catch (error) {
      console.error('Error in I_QUOTE_REPLY_NODE replace:', error);
      replaceElementWithUnknownMention(parent, 'Unknown Quote Reply');
    }
  },
};

/** External Markdown transformer for channel quote-reply references. */
export const E_QUOTE_REPLY_NODE: ElementTransformer = {
  dependencies: [QuoteReplyNode],
  type: 'element',
  regExp: /$^/,
  export: (node: LexicalNode) => {
    if (!$isQuoteReplyNode(node)) return null;
    const { displayText } = node.exportComponentProps();
    return displayText
      .split('\n')
      .map((line) => `> ${line}`)
      .join('\n');
  },
  replace: () => false,
};
