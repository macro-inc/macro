import { createHeadlessEditor } from '@lexical/headless';
import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
} from '@lexical/markdown';
import { $getRoot } from 'lexical';
import { NodeReplacements, SupportedNodeTypes } from '../node-list';
import { $createAgentContextNode } from '../nodes/AgentContextNode';
import { ALL_TRANSFORMERS } from '../transformers';

/** A prior channel message supplied as untrusted agent context. */
export type AgentContextMessage = {
  sender: string;
  content: string;
};

/** The authorized conversation a prompt was posted in. */
export type AgentContextParent = {
  type: 'channel' | 'document';
  id: string;
};

/** Input used to compose an agent prompt with private conversation context. */
export type AgentContextPrompt = {
  promptMarkdown: string;
  /** Supplied by the message service, never by the prompt's author. */
  parent?: AgentContextParent;
  messages?: AgentContextMessage[];
};

function escapeAgentContextTags(markdown: string): string {
  // No user-authored entity may decode into reserved syntax during import.
  return markdown
    .replace(/&/g, '&amp;')
    .replace(/<m-agent-context>/g, '&amp;lt;m-agent-context>')
    .replace(/<\/m-agent-context>/g, '&amp;lt;/m-agent-context>');
}

/**
 * Prefix a prompt with a private AgentContext node naming the conversation it
 * came from and containing its chronological history. The internal markdown
 * transformer owns envelope encoding.
 */
export function composeAgentContextPrompt(input: AgentContextPrompt): string {
  const editor = createHeadlessEditor({
    nodes: [...SupportedNodeTypes, ...NodeReplacements],
  });

  editor.update(
    () => {
      $convertFromMarkdownString(
        escapeAgentContextTags(input.promptMarkdown),
        ALL_TRANSFORMERS
      );
    },
    { discrete: true }
  );

  editor.update(
    () => {
      if (!input.messages?.length && !input.parent) return;

      const history = (input.messages ?? [])
        .map(
          (message, index) =>
            `Prior message ${index + 1}:\nSender: ${message.sender}\nContent: ${message.content}`
        )
        .join('\n\n');
      const location = input.parent
        ? `Conversation parent: ${JSON.stringify(input.parent)}`
        : '';
      const context = $createAgentContextNode({
        version: 1,
        text: [location, history].filter(Boolean).join('\n\n'),
      });
      const firstChild = $getRoot().getFirstChild();
      if (firstChild) firstChild.insertBefore(context);
      else $getRoot().append(context);
    },
    { discrete: true }
  );

  return editor
    .getEditorState()
    .read(() => $convertToMarkdownString(ALL_TRANSFORMERS));
}
