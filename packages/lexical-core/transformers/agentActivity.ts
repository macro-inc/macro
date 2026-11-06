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

/**
 * Escape what would end the tag or its line inside the JSON payload. Steps
 * carry commands and file names as written, so `</m-agent-activity>` and
 * line separators can appear in them; JSON.parse reads the escapes back.
 */
function escapeJsonEnvelopeCharacter(character: string): string {
  if (character === '<') return '\\u003c';
  if (character === '\u2028') return '\\u2028';
  return '\\u2029';
}

/** Internal markdown transformer for an agent reply's steps. */
export const I_AGENT_ACTIVITY: ElementTransformer = {
  dependencies: [AgentActivityNode, UnknownMentionNode],
  type: 'element',
  regExp: /<m-agent-activity>(.*?)<\/m-agent-activity>/s,
  export: (node: LexicalNode) => {
    if (!$isAgentActivityNode(node)) return null;
    const payload = JSON.stringify(node.exportComponentProps()).replace(
      /[<\u2028\u2029]/g,
      escapeJsonEnvelopeCharacter
    );
    return `<m-agent-activity>${payload}</m-agent-activity>`;
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
