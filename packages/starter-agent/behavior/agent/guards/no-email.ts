import type { Guard, ToolCall } from '../guard.ts';

/**
 * Denies any tool call that would send email: Gmail compose and send,
 * AgentMail sends, mail programs, mailto links, the send tools of mail MCP
 * servers, and the agent's own mailbox reached around its capability (the
 * SDK's mailbox, its routes, the capability's port and its drafts). Reading
 * connected mail stays allowed. The one way out is the mailbox capability:
 * sendMyEmail and replyToMyEmail, which send a draft only after the owner
 * approved it.
 *
 * It matches text, so it catches the plain ways and mistakes, not code
 * written to hide what it calls (a name built from pieces, a decoded
 * string). The capability's approval check runs in the agent's own code
 * too; the server, today, requires only a non-empty confirmation and its
 * send caps.
 */
export const noEmailReason =
  "You don't send email, except from your own address with sendMyEmail or replyToMyEmail, after your owner approves the draft. If only an email would move this, tell your owner.";

const sends: readonly RegExp[] = [
  // Gmail's compose URL.
  /view=cm\b/i,
  // The Gmail tab: compose, or the Send button.
  /mail\.google\.com[^\n]*(#compose|compose=|text=send\b|label\*?=["']?send)/i,
  /agentmail[^\n]*(\/send\b|send_message|messages\.send|\.send\()/i,
  /\b(sendmail|msmtp|mailx|mutt|swaks)\b/,
  /\bmailto:/i,
  /\bsmtp(s)?:\/\//i,
  // The API, around the capability.
  /gmail\.googleapis\.com[^\n]*(\/send\b|\/drafts\b)/i,
  /\bsmtp\.gmail\.com\b/i,
  // The send credential is the capability's alone.
  /\bMAIL_(REFRESH_TOKEN|CLIENT_SECRET|CLIENT_ID)\b/,
  // The agent's own mailbox, around the mailbox capability: the SDK's
  // namespace, its message handles and types, its raw client calls, and its
  // routes; the capability's port, and the drafts it checks sends against.
  /\bagentMailbox\b/,
  /\bAgentMail[A-Z]\w*/,
  /\b(get|list|read|send|reply)AgentMailbox\w*/,
  /\/agent-mailbox\b/i,
  /\bsdkMailbox\b|\bdraftStore\b/,
  /capabilities\/mailbox\/(macro|drafts|service)(\.ts)?\b/,
  /\/mailbox\/drafts\b/,
];

/** Tools that only read files: naming the mailbox's code there sends nothing. */
const readers: ReadonlySet<string> = new Set(['Read', 'Glob', 'Grep']);

/** Why this call is refused, or undefined if it doesn't send email. */
export const sendsEmail = ({ tool, input }: ToolCall): string | undefined => {
  if (readers.has(tool)) return undefined;
  if (/mail/i.test(tool) && /(send|reply|forward|draft_send)/i.test(tool))
    return noEmailReason;
  const text = JSON.stringify(input ?? {});
  return sends.some((send) => send.test(text)) ? noEmailReason : undefined;
};

export const noEmail: Guard = { name: 'no-email', check: sendsEmail };
