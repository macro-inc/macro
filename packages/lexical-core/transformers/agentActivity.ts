import type { ElementTransformer } from '@lexical/markdown';
import type { ElementNode, LexicalNode } from 'lexical';
import {
  $createAgentActivityNode,
  $isAgentActivityNode,
  AgentActivityNode,
  isAgentActivityData,
} from '../nodes/AgentActivityNode';
import {
  replaceElementWithUnknownMention,
  UnknownMentionNode,
} from './unknownFallback';

/** Internal markdown transformer for an agent reply's steps. */
export const I_AGENT_ACTIVITY: ElementTransformer = {
  dependencies: [AgentActivityNode, UnknownMentionNode],
  type: 'element',
  regExp: /<m-agent-activity>(.*?)<\/m-agent-activity>/,
  export: (node: LexicalNode) => {
    if (!$isAgentActivityNode(node)) return null;
    return `<m-agent-activity>${JSON.stringify(node.exportComponentProps())}</m-agent-activity>`;
  },
  replace: (parent: ElementNode, _, match: string[]) => {
    try {
      const data: unknown = JSON.parse(match[1] ?? '');
      if (!isAgentActivityData(data))
        throw new Error('invalid agent activity data');
      parent.replace($createAgentActivityNode(data));
    } catch (error) {
      console.error('Error in I_AGENT_ACTIVITY replace:', error);
      replaceElementWithUnknownMention(parent, 'Unknown agent activity');
    }
  },
};
