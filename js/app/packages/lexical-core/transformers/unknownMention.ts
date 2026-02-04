import type { TextMatchTransformer } from '@lexical/markdown';
import type { LexicalNode, TextNode } from 'lexical';
import {
  $createUnknownMentionNode,
  $isUnknownMentionNode,
  UnknownMentionNode,
} from '../nodes/UnknownMentionNode';

// Transformer for unknown/unrecognized XML tags
// This acts as a fallback to capture any XML-like tags that don't have specific handlers
export const UNKNOWN_MENTION: TextMatchTransformer = {
  dependencies: [UnknownMentionNode],
  type: 'text-match',
  // Match any XML tag that starts with 'm-' or other prefixes we don't recognize
  // This should be registered AFTER all known transformers to act as a fallback
  regExp: /<([a-zA-Z0-9_-]+)>(.*?)<\/\1>/s,
  importRegExp: /<([a-zA-Z0-9_-]+)>(.*?)<\/\1>/s,

  export: (node: LexicalNode) => {
    if (!$isUnknownMentionNode(node)) return null;

    const tagName = node.getName();

    return `<${tagName}></${tagName}>`;
  },

  replace: (textNode: TextNode, match: RegExpMatchArray) => {
    try {
      const name = match[1];
      const unknownMentionNode = $createUnknownMentionNode({ name });
      textNode.replace(unknownMentionNode);
    } catch (e) {
      console.error('Error in UNKNOWN_MENTION replace:', e);
    }
  },
};
