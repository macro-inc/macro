import type { Log } from '../../context/log.ts';
import type { Chat } from './macro.ts';

type Outgoing = Pick<Chat, 'send' | 'reply' | 'dm'>;

// Each pattern is narrow on purpose: a false warning on ordinary prose makes
// the warning meaningless. Case-sensitive where the real thing always is.
const internalWording = [
  {
    // `macro.email.inbox()`, never "Macro.", a macro.com URL or an email.
    reason: 'sdk-call',
    pattern: /(?<![@/.\w])macro\.(?!com\b)[a-z_$][\w$]*(?:\.[a-z_$][\w$]*)*/,
  },
  { reason: 'agent-command', pattern: /\bbin\/agent\b/ },
  {
    // The code-mode tools, which aren't in the agent's catalog.
    reason: 'tool-name',
    pattern:
      /\b(?:RunCapabilityScript|DescribeCapabilities|ExecuteCode|DescribeCodeTools|ReadCodeDocs)\b/,
  },
  {
    reason: 'execution-details',
    pattern:
      /\b(?:code[ -]mode|capability scripts?)\b|@macro-inc\/muppet\b|\bmuppet\//i,
  },
  {
    reason: 'raw-error',
    pattern:
      /\bHTTP\s*[45]\d\d\b|\bstatus(?: code)? [45]\d\d\b|\bat \S+ \(.*:\d+:\d+\)|^Error: /im,
  },
];

/** Whether `text` names one of the catalog's functions (camelCase, so never an everyday word). */
const namesTool = (text: string, names: Iterable<string>): boolean => {
  for (const name of names)
    if (
      /^[a-z]+[A-Z]\w*$/.test(name) &&
      new RegExp(`(?<![\\w.])${name}(?![\\w])`).test(text)
    )
      return true;
  return false;
};

/** Observe internal wording without making delivery depend on the warning. */
export const observeOutgoing = (
  chat: Outgoing,
  log: Pick<Log, 'event'>,
  /** The agent's own function names, from its capability catalog. */
  toolNames: () => Iterable<string>
): Outgoing => {
  const warn = async (text: string) => {
    const found = internalWording
      .filter(({ pattern }) => pattern.test(text))
      .map(({ reason }) => reason);
    const reasons =
      !found.includes('tool-name') && namesTool(text, toolNames())
        ? [...found, 'tool-name']
        : found;
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
