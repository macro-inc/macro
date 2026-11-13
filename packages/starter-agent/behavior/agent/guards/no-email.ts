import type { Guard, ToolCall } from '../guard.ts';

/**
 * Denies any tool call that would send email: Gmail compose and send,
 * AgentMail sends, mail programs, mailto links, and the send tools of mail
 * MCP servers. Reading mail stays allowed. The one way out is the
 * replyToMail capability, which holds the send credential and its own rules
 * about whom it answers; nothing here matches it.
 */
export const noEmailReason =
  "You don't send email, except with replyToMail, which decides on its own whom it may answer. If only an email would move this, tell your owner.";

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
];

/** Why this call is refused, or undefined if it doesn't send email. */
export const sendsEmail = ({ tool, input }: ToolCall): string | undefined => {
  if (/mail/i.test(tool) && /(send|reply|forward|draft_send)/i.test(tool))
    return noEmailReason;
  const text = JSON.stringify(input ?? {});
  return sends.some((send) => send.test(text)) ? noEmailReason : undefined;
};

export const noEmail: Guard = { name: 'no-email', check: sendsEmail };
