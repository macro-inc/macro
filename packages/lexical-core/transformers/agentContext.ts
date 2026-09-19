import type { ElementTransformer } from '@lexical/markdown';
import {
  $createTextNode,
  $isRootNode,
  type ElementNode,
  type LexicalNode,
} from 'lexical';
import {
  $createAgentContextNode,
  $isAgentContextNode,
  AgentContextNode,
  isAgentContextData,
} from '../nodes/AgentContextNode';
import {
  replaceElementWithUnknownMention,
  UnknownMentionNode,
} from './unknownFallback';

function escapeJsonEnvelopeCharacter(character: string): string {
  if (character === '<') return '\\u003c';
  if (character === '\u2028') return '\\u2028';
  return '\\u2029';
}

/** Internal markdown transformer for private agent context. */
export const I_AGENT_CONTEXT: ElementTransformer = {
  dependencies: [AgentContextNode, UnknownMentionNode],
  type: 'element',
  regExp: /^<m-agent-context>(.*?)<\/m-agent-context>$/s,
  export: (node: LexicalNode) => {
    if (!$isAgentContextNode(node)) return null;
    const payload = JSON.stringify(node.exportComponentProps()).replace(
      /[<\u2028\u2029]/g,
      escapeJsonEnvelopeCharacter
    );
    return `<m-agent-context>${payload}</m-agent-context>`;
  },
  replace: (parent: ElementNode, _, match: string[]) => {
    // The harness authors exactly one context node before the user's prompt.
    // A matching tag later in the prompt (or inside a quote) is user content
    // and must remain visible rather than becoming hidden metadata.
    if (!$isRootNode(parent.getParent()) || parent.getPreviousSibling() !== null) {
      parent.clear().append($createTextNode(match[0] ?? ''));
      return;
    }
    try {
      const data: unknown = JSON.parse(match[1] ?? '');
      if (
        !isAgentContextData(data) ||
        Object.keys(data as Record<string, unknown>).length !== 2
      ) {
        throw new Error('invalid agent context data');
      }
      parent.replace($createAgentContextNode(data));
    } catch (error) {
      console.error('Error in I_AGENT_CONTEXT replace:', error);
      replaceElementWithUnknownMention(parent, 'Unknown Agent Context');
    }
  },
};
