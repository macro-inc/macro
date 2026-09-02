import type { ElementTransformer } from '@lexical/markdown';
import type { ElementNode, LexicalNode } from 'lexical';
import {
  $createReplyTargetNode,
  $isReplyTargetNode,
  buildReplyTargetMarkdown,
  isReplyTargetData,
  ReplyTargetNode,
} from '../nodes/ReplyTargetNode';
import {
  replaceElementWithUnknownMention,
  UnknownMentionNode,
} from './unknownFallback';

/** Internal Markdown transformer for channel reply-target references. */
export const I_REPLY_TARGET_NODE: ElementTransformer = {
  dependencies: [ReplyTargetNode, UnknownMentionNode],
  type: 'element',
  regExp: /^<m-reply-target>(.*?)<\/m-reply-target>$/s,
  export: (node: LexicalNode) => {
    if (!$isReplyTargetNode(node)) return null;
    return buildReplyTargetMarkdown(node.exportComponentProps());
  },
  replace: (parent: ElementNode, _, match: string[]) => {
    try {
      const data: unknown = JSON.parse(match[1] ?? '');
      if (!isReplyTargetData(data)) {
        throw new Error('invalid reply-target data');
      }
      parent.replace($createReplyTargetNode(data));
    } catch (error) {
      console.error('Error in I_REPLY_TARGET_NODE replace:', error);
      replaceElementWithUnknownMention(parent, 'Unknown Reply Target');
    }
  },
};

/** External Markdown transformer for channel reply-target references. */
export const E_REPLY_TARGET_NODE: ElementTransformer = {
  dependencies: [ReplyTargetNode],
  type: 'element',
  regExp: /$^/,
  export: (node: LexicalNode) => {
    if (!$isReplyTargetNode(node)) return null;
    const { displayText } = node.exportComponentProps();
    return displayText
      .split('\n')
      .map((line) => `> ${line}`)
      .join('\n');
  },
  replace: () => false,
};
