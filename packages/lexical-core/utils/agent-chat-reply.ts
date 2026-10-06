import { createHeadlessEditor } from '@lexical/headless';
import { $convertToMarkdownString } from '@lexical/markdown';
import { $createParagraphNode, $getRoot } from 'lexical';
import { NodeReplacements, SupportedNodeTypes } from '../node-list';
import { $createAgentSessionMentionNode } from '../nodes/AgentSessionMentionNode';
import { $createAwaitNode } from '../nodes/AwaitNode';
import { ALL_TRANSFORMERS } from '../transformers';

/**
 * What the session link reads as wherever the channel markdown is shown as
 * text: notification excerpts, search, plain-text previews.
 */
export const AGENT_SESSION_LINK_LABEL = 'Agent session';

/** The spinner's caption while a chat agent's turn runs. */
export const PENDING_REPLY_TEXT = 'Thinking…';

/**
 * What a chat agent's message says below its session link: the spinner
 * while the turn runs, or prose - the answer, a fallback the harness wrote
 * for a turn that said nothing, a question the thread cannot answer.
 */
export type AgentChatReplyBody =
  | { kind: 'pending' }
  | { kind: 'markdown'; markdown: string };

/** A chat agent's message in its thread, in one of its states. */
export type AgentChatReply = {
  sessionId: string;
  body: AgentChatReplyBody;
};

/**
 * Compose a chat agent's thread message: a link to its session as the
 * agent-session mention node, alone in the first paragraph, then the body.
 *
 * The channel message view lifts a leading mention paragraph out of the body
 * onto the sender line, which is why the link goes first and why every state
 * of the reply carries it: a patch replaces the content wholesale, and a
 * link only the pending reply had would vanish with the spinner.
 *
 * The nodes are built and serialized headlessly so the markdown is exactly
 * what the editor's own transformers read back, escaping included. Prose is
 * appended as written rather than round-tripped through the editor: it is
 * the agent's answer, and normalizing it is not this function's job.
 */
export function composeAgentChatReply(reply: AgentChatReply): string {
  const editor = createHeadlessEditor({
    nodes: [...SupportedNodeTypes, ...NodeReplacements],
  });
  editor.update(
    () => {
      const root = $getRoot();
      root.append(
        $createParagraphNode().append(
          $createAgentSessionMentionNode({
            id: reply.sessionId,
            label: AGENT_SESSION_LINK_LABEL,
          })
        )
      );
      if (reply.body.kind === 'pending') {
        root.append(
          $createParagraphNode().append(
            $createAwaitNode({ text: PENDING_REPLY_TEXT, inline: true })
          )
        );
      }
    },
    { discrete: true }
  );
  const chrome = editor
    .getEditorState()
    .read(() => $convertToMarkdownString(ALL_TRANSFORMERS));
  return reply.body.kind === 'pending'
    ? chrome
    : `${chrome}\n\n${reply.body.markdown}`;
}
