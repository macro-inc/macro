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

/** Input used to compose an agent prompt with private channel context. */
export type AgentContextPrompt = {
  promptMarkdown: string;
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
 * Prefix a prompt with a private AgentContext node containing chronological
 * channel history. The internal markdown transformer owns envelope encoding.
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
      if (!input.messages?.length) return;

      const contextText = input.messages
        .map(
          (message, index) =>
            `Prior message ${index + 1}:\nSender: ${message.sender}\nContent: ${message.content}`
        )
        .join('\n\n');
      const context = $createAgentContextNode({
        version: 1,
        text: contextText,
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
