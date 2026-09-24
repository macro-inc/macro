import type { MessageData } from '@core/messages/types';
import { isBotSenderId } from '@queries/messages/message-sender';

/**
 * The session a channel message from an agent came from.
 *
 * The agent harness leads every message a chat agent posts into a thread -
 * the pending spinner and each patch that replaces it - with an
 * `<m-agent-session-mention>` node naming the session, as its own first
 * paragraph. It is chrome, not body: the message view lifts it onto the
 * sender line as a small link and renders what follows as the message.
 */
export type AgentSessionLink = {
  sessionId: string;
};

/** A message split into the chrome the harness prefixed and its body. */
export type SplitMessageContent = {
  link: AgentSessionLink | undefined;
  body: string;
};

/**
 * The exact serialization `I_AGENT_SESSION_MENTION` reads - one JSON object
 * inside the tag, with no line breaks - anchored to the start, plus the
 * blank line the harness puts after it.
 */
const LEADING_AGENT_SESSION_MENTION =
  /^<m-agent-session-mention>(.*?)<\/m-agent-session-mention>[ \t]*(?:\r?\n)*/;

function isAgentSessionMentionInfo(value: unknown): value is { id: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    typeof value.id === 'string' &&
    value.id.length > 0
  );
}

/**
 * Split a leading agent-session mention off `content`. Content that does
 * not start with one, or whose node does not parse, is all body.
 */
export function splitLeadingAgentSessionLink(
  content: string
): SplitMessageContent {
  const match = LEADING_AGENT_SESSION_MENTION.exec(content);
  if (!match) return { link: undefined, body: content };
  let parsed: unknown;
  try {
    parsed = JSON.parse(match[1] ?? '');
  } catch {
    return { link: undefined, body: content };
  }
  if (!isAgentSessionMentionInfo(parsed)) {
    return { link: undefined, body: content };
  }
  return {
    link: { sessionId: parsed.id },
    body: content.slice(match[0].length),
  };
}

/**
 * The message as the view renders it. Only an agent's message is split: a
 * person who opens their own message with a session mention meant it as
 * part of what they said.
 */
export function splitMessageContent(message: MessageData): SplitMessageContent {
  if (!isBotSenderId(message.sender_id)) {
    return { link: undefined, body: message.content };
  }
  return splitLeadingAgentSessionLink(message.content);
}
