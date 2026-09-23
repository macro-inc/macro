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

/** Where in a document the comment thread a prompt was posted in sits. */
export type AgentContextAnchor = {
  markId: string;
  /** What the mark covered when the comment was posted; absent on threads anchored before it was captured. */
  markedText?: string;
  /** What the mark covers in the document now, when it could be resolved. */
  currentMarkedText?: string;
  /** The passage around the mark now, when it could be resolved. */
  surroundingText?: string;
};

/** Input used to compose an agent prompt with private conversation context. */
export type AgentContextPrompt = {
  promptMarkdown: string;
  /** Supplied by the message service, never by the prompt's author. */
  parent?: AgentContextParent;
  anchor?: AgentContextAnchor;
  messages?: AgentContextMessage[];
};

/**
 * Name the document range a comment marks. The mark id identifies it, but
 * nothing the agent can read maps that id back onto text, so the text travels
 * with it: as the document reads now when it could be resolved, and as it read
 * when the comment was posted, which is all there is when the live lookup
 * failed or the text has since been removed.
 */
function describeAnchor(anchor: AgentContextAnchor): string {
  const location = `Comment anchor: ${JSON.stringify(anchor)}`;
  if (anchor.currentMarkedText !== undefined) {
    const snapshot =
      anchor.markedText === undefined
        ? ''
        : ' markedText is what it covered when the comment was posted; if the two differ, the text was edited since.';
    return `${location}\ncurrentMarkedText is what the mark covers in the document now and surroundingText the passage around it.${snapshot}`;
  }
  if (anchor.markedText === undefined) return location;
  return `${location}\nmarkedText is what the mark covered when the comment was posted; the document may have changed since.`;
}

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
      if (!input.messages?.length && !input.parent && !input.anchor) return;

      const history = (input.messages ?? [])
        .map(
          (message, index) =>
            `Prior message ${index + 1}:\nSender: ${message.sender}\nContent: ${message.content}`
        )
        .join('\n\n');
      const location = input.parent
        ? `Conversation parent: ${JSON.stringify(input.parent)}`
        : '';
      const anchor = input.anchor ? describeAnchor(input.anchor) : '';
      const context = $createAgentContextNode({
        version: 1,
        text: [location, anchor, history].filter(Boolean).join('\n\n'),
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
