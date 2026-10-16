import { createHeadlessEditor } from '@lexical/headless';
import { $convertToMarkdownString } from '@lexical/markdown';
import { $createParagraphNode, $getRoot } from 'lexical';
import { NodeReplacements, SupportedNodeTypes } from '../node-list';
import {
  $createAgentActivityNode,
  type AgentActivityRow,
} from '../nodes/AgentActivityNode';
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
 * One segment of an agent's reply, as a message shows it: a passage as the
 * agent wrote it, or the steps it took between passages.
 */
export type AgentReplySegment =
  | { kind: 'prose'; markdown: string }
  | {
      kind: 'activity';
      turn: number;
      segment: number;
      rows: AgentActivityRow[];
      sealed: boolean;
    };

/**
 * What a chat agent's message says below its session link: the spinner
 * while the turn runs, or prose - the answer, a fallback the harness wrote
 * for a turn that said nothing, a question the thread cannot answer - or the
 * reply's segments, passages and steps in the order the agent produced them.
 */
export type AgentChatReplyBody =
  | { kind: 'pending' }
  | { kind: 'markdown'; markdown: string }
  | {
      kind: 'segments';
      segments: AgentReplySegment[];
      /** Show the spinner after the segments: the turn is still running. */
      pending?: boolean;
      /** A closing line the harness wrote: stopped, failed, said nothing. */
      footer?: string;
    };

/** A chat agent's message in its thread, in one of its states. */
export type AgentChatReply = {
  sessionId: string;
  body: AgentChatReplyBody;
  /**
   * Lead with a link to the session. A thread reply does, so a reader can
   * open the session the answer came from; a private conversation's
   * messages are the session, and repeat no link. Defaults to true.
   */
  link?: boolean;
};

function editor() {
  return createHeadlessEditor({
    nodes: [...SupportedNodeTypes, ...NodeReplacements],
  });
}

/** Serialize nodes built in `build` exactly as the editor's transformers do. */
function serialize(build: () => void): string {
  const headless = editor();
  headless.update(build, { discrete: true });
  return headless
    .getEditorState()
    .read(() => $convertToMarkdownString(ALL_TRANSFORMERS));
}

function chrome(reply: AgentChatReply, pending: boolean): string {
  return serialize(() => {
    const root = $getRoot();
    if (reply.link !== false) {
      root.append(
        $createParagraphNode().append(
          $createAgentSessionMentionNode({
            id: reply.sessionId,
            label: AGENT_SESSION_LINK_LABEL,
          })
        )
      );
    }
    if (pending) {
      root.append(
        $createParagraphNode().append(
          $createAwaitNode({ text: PENDING_REPLY_TEXT, inline: true })
        )
      );
    }
  });
}

function segmentMarkdown(
  sessionId: string,
  segment: AgentReplySegment
): string {
  if (segment.kind === 'prose') return segment.markdown;
  return serialize(() => {
    $getRoot().append(
      $createAgentActivityNode({
        agentSessionId: sessionId,
        turn: segment.turn,
        segment: segment.segment,
        rows: segment.rows.map((row) =>
          row.detail
            ? row
            : { id: row.id, label: row.label, status: row.status }
        ),
        sealed: segment.sealed,
      })
    );
  });
}

/**
 * Compose a chat agent's message: a link to its session as the
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
  const { body } = reply;
  if (body.kind !== 'segments') {
    const head = chrome(reply, body.kind === 'pending');
    if (body.kind === 'pending') return head;
    return [head, body.markdown].filter(Boolean).join('\n\n');
  }
  const head = chrome(reply, false);
  const tail = body.pending ? chrome({ ...reply, link: false }, true) : '';
  return [
    head,
    ...body.segments.map((segment) =>
      segmentMarkdown(reply.sessionId, segment)
    ),
    body.footer ? `_${body.footer}_` : '',
    tail,
  ]
    .filter((part) => part.trim().length > 0)
    .join('\n\n');
}
