import type { Log } from '../../context/log.ts';
import type { Chat } from './macro.ts';

type Outgoing = Pick<Chat, 'send' | 'reply' | 'dm'>;

const internalWording = [
  { reason: 'sdk-call', pattern: /\bmacro(?:\s*\.\s*[a-z_$][\w$]*)+/i },
  { reason: 'agent-command', pattern: /\bbin\/agent\b/i },
  {
    reason: 'tool-name',
    pattern:
      /\b(?:RunCapabilityScript|DescribeCapabilities|ExecuteCode|DescribeCodeTools|ReadCodeDocs)\b/i,
  },
  {
    reason: 'execution-details',
    pattern: /\b(?:code[ -]mode|capability scripts?|muppet)\b/i,
  },
];

/** Observe internal wording without making delivery depend on the warning. */
export const observeOutgoing = (
  chat: Outgoing,
  log: Pick<Log, 'event'>
): Outgoing => {
  const warn = async (text: string) => {
    const reasons = internalWording
      .filter(({ pattern }) => pattern.test(text))
      .map(({ reason }) => reason);
    if (reasons.length === 0) return;
    // Keep only categories: messages can contain private information. This
    // is advisory because a heuristic must not suppress someone's reply.
    await log
      .event('chat', { kind: 'internal-wording', reasons })
      .catch(() => undefined);
  };
  return {
    send: async (channelId, text) => {
      await warn(text);
      return chat.send(channelId, text);
    },
    reply: async (channelId, root, text) => {
      await warn(text);
      return chat.reply(channelId, root, text);
    },
    dm: async (userId, text) => {
      await warn(text);
      return chat.dm(userId, text);
    },
  };
};
