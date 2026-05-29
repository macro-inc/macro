import type { TextMatchTransformer } from '@lexical/markdown';
import type { TextNode } from 'lexical';
import { $createAgentStatusNode, AgentStatusNode } from '../nodes/AgentStatusNode';

/**
 * Internal transformer for the agent status node. Round-trips through a
 * `<m-agent-status>{json}</m-agent-status>` sentinel, matching the convention
 * used by the mention transformers.
 */
export const I_AGENT_STATUS: TextMatchTransformer = {
  dependencies: [AgentStatusNode],
  type: 'text-match',
  regExp: /<m-agent-status>(.*?)<\/m-agent-status>/,
  importRegExp: /<m-agent-status>(.*?)<\/m-agent-status>/,
  export: (node) => {
    if (!(node instanceof AgentStatusNode)) return null;
    const data = JSON.stringify({ statusText: node.getStatusText() });
    return `<m-agent-status>${data}</m-agent-status>`;
  },
  replace: (node: TextNode, match: RegExpMatchArray) => {
    try {
      const data = JSON.parse(match[1]);
      if (!('statusText' in data)) throw new Error('Missing field statusText');
      node.replace($createAgentStatusNode({ statusText: data.statusText }));
    } catch (e) {
      console.error('Error in I_AGENT_STATUS replace:', e);
    }
  },
};
