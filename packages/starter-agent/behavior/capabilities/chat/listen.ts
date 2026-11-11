/**
 * The listener's decisions: is a Macro message for the agent? Pure; the
 * handler supplies the history and the relevance screen.
 */
import { z } from 'zod';
import type { Entry, Incoming } from './entry.ts';

export type Probabilities = Readonly<Record<string, number>>;

/**
 * The relevance screen: yes/no questions asked of a cheap model, and the bar
 * a yes must clear. Each question is one reason a message can be for the
 * agent: a message is for it when any of them clears the bar.
 */
export const Screen = z.object({
  threshold: z.number().min(0).max(1),
  questions: z.record(z.string(), z.string()),
});
export type Screen = Readonly<z.infer<typeof Screen>>;

/** Some mentions arrive with nothing recorded and only the tag in the text. */
export const textMentions = (text: string, ids: readonly string[]): boolean =>
  [...text.matchAll(/<m-user-mention>[^<]*"userId":"([^"]+)"/g)].some(
    ([, id]) => id !== undefined && ids.includes(id)
  );

/** Does any of the screen's questions clear its bar? A key the screen doesn't ask about counts for nothing. */
export const isRelevant = (p: Probabilities, screen: Screen): boolean =>
  Object.keys(screen.questions).some(
    (question) => (p[question] ?? 0) >= screen.threshold
  );

/** Has the agent posted in this thread (its root, or a reply in it)? */
export const inThread = (
  history: readonly Entry[],
  me: string,
  thread: string | null | undefined
): boolean =>
  thread !== null &&
  thread !== undefined &&
  thread !== '' &&
  history.some(
    (entry) =>
      entry.sender_id === me &&
      (entry.thread === thread || entry.root === thread || entry.id === thread)
  );

export type Verdict =
  | { readonly kind: 'ignored' }
  | {
      readonly kind: 'irrelevant';
      readonly p: Probabilities;
    }
  | {
      readonly kind: 'relevant';
      readonly mentioned: boolean;
      readonly p: Probabilities;
    };

/** What a DM or a mention is logged with: nobody asked the screen. */
const addressed: Probabilities = { addressed: 1 };

/**
 * Decides whether a message is for the agent. Never its own posts or a
 * bot's. A DM always is, and so is an @mention; the screen only judges the
 * rest. When the screen fails it is asked again with less history, and
 * failing that, a reply in a thread the agent is in is for it, so the
 * message isn't lost.
 */
export const judge = async (
  { channel, entry, mentions }: Incoming,
  {
    me,
    name,
    history,
    screen,
    decide,
    failed,
  }: {
    /** The agent's Macro id. */
    readonly me: string;
    /** The name the agent answers to, so the screen can tell when it is addressed. */
    readonly name: string;
    /** The conversation's recent messages, before this one. */
    readonly history: readonly Entry[];
    readonly screen: Screen;
    readonly decide: (
      input: unknown,
      questions: Screen['questions']
    ) => Promise<Probabilities>;
    /** Told when the screen fails, for the log. */
    readonly failed: (error: unknown) => Promise<void>;
  }
): Promise<Verdict> => {
  const sender = entry.sender_id;
  if (sender === '' || sender === me || sender.startsWith('bot|'))
    return { kind: 'ignored' };

  const mentioned = mentions.includes(me) || textMentions(entry.text, [me]);
  if (mentioned || entry.dm)
    return { kind: 'relevant', mentioned, p: addressed };
  const ask = (recent: readonly Entry[]) =>
    decide(
      {
        assistant: { name, id: me },
        channel,
        recent_messages: recent,
        new_message: entry,
      },
      screen.questions
    );
  const p = await ask(history).catch(async (error: unknown) => {
    await failed(error);
    return ask(history.slice(-2)).catch(() => undefined);
  });
  if (p === undefined) {
    const fallback = { fallback: 1 };
    return inThread(history, me, entry.thread ?? entry.root)
      ? { kind: 'relevant', mentioned, p: fallback }
      : { kind: 'irrelevant', p: fallback };
  }
  return isRelevant(p, screen)
    ? { kind: 'relevant', mentioned, p }
    : { kind: 'irrelevant', p };
};
