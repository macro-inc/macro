import { behavior, type ContextOf } from '@macro-inc/muppet/core/behavior';
import { channel } from '@macro-inc/muppet/core/event';
import { z } from 'zod';
import type { Trace } from '../../agent/claude.ts';
import type { Base } from '../../context/index.ts';
import { batches } from '../../context/stream.ts';
import type { Conversation, Queued } from './entry.ts';
import { history } from './history.ts';
import { Screen } from './listen.ts';
import { sdkChat } from './macro.ts';
import { observeOutgoing } from './outgoing.ts';
import { typing } from './typing.ts';

/** The owner of chat's state directories. */
export const owner = 'chat';

const historyDirectory = 'history';
const screenModule = z.object({ screen: Screen });
/** The screen's file, beside this one. */
const screenFile = 'screen.ts';
const queueDirectory = 'queue';
const reconnectSpan = 'chat.events.reconnect';

/** The longest a `chat.events.reconnect` span stays open: one never ended is never exported. */
const longestOutageSpan = 60_000;

/**
 * Times the events stream's outages: each drop is a `chat.events.reconnect`
 * span from the drop until the stream opens again (`chat.events.reopened`),
 * or for at most `longest` ms while it stays down, so an outage that never
 * ends (or a process stopped during one) is still exported. It carries how
 * many drops there have been in this process, so a flapping stream shows as
 * a rising count. Messages posted until it reopens are missed unless
 * resynced.
 */
export const streamOutages = (trace: Trace, longest = longestOutageSpan) => {
  let drops = 0;
  let reopened: (() => void) | undefined;
  return {
    dropped: (): void => {
      reopened?.();
      drops += 1;
      const count = drops;
      const open = Promise.withResolvers<boolean>();
      reopened = () => open.resolve(true);
      const timer = setTimeout(() => open.resolve(false), longest);
      timer.unref?.();
      void trace(reconnectSpan, async (span) => {
        span.set('chat.events.reconnects', count);
        span.set('chat.events.reopened', await open.promise);
        clearTimeout(timer);
      });
    },
    opened: (): void => {
      reopened?.();
      reopened = undefined;
    },
  };
};

/** Where the incoming stream left off, so a restart resumes it. */
const cursorName = 'stream-cursor.json';
const StreamCursor = z.object({
  eventId: z.string().optional(),
  at: z.string(),
});

/** What chat adds to the agent's context: Macro, what it remembers of conversations, and who is waiting on it. */
export const chatContext = (
  { macro, config, state, join, disk, log, trace }: Base,
  /** The agent's function names, from its catalog once it is built. */
  toolNames: () => Iterable<string> = () => []
) => {
  const cursorFile = join(state.run(owner), cursorName);
  const sdk = sdkChat({
    macro,
    myName: config.identity.name,
    trace,
    stream: streamOutages(trace),
    cursor: {
      read: async () => {
        const text = await disk.read(cursorFile);
        if (text === undefined) return undefined;
        // A file that isn't a cursor throws: the catch-up then reads the
        // whole window, not nothing.
        return StreamCursor.parse(JSON.parse(text));
      },
      write: (cursor) => disk.write(cursorFile, JSON.stringify(cursor)),
    },
  });
  const chat = { ...sdk, ...observeOutgoing(sdk, log, toolNames) };
  const unanswered = channel<Conversation>();
  const screenPath = join(import.meta.dir, screenFile);
  return behavior<Base>().decorate({
    chat,
    typing: typing({ send: chat.typing }),
    history: history({
      directory: join(state.private(owner), historyDirectory),
      queue: join(state.run(owner), queueDirectory),
      join,
      disk,
    }),
    // Imported afresh whenever the file has changed, so the agent's tuning of
    // the screen takes effect without a restart. A file that no longer holds
    // a screen throws, and the message falls back to "is the agent in this
    // thread".
    relevanceScreen: async (): Promise<Screen> =>
      screenModule.parse(
        await import(
          `${screenPath}?at=${(await disk.modified(screenPath))?.epochMilliseconds ?? 0}`
        )
      ).screen,
    /** Messages waiting for a reply, batched by conversation. */
    waiting: batches<Queued>(),
    /** Conversations a reply run failed to answer. The later area hands them to a run of their own. */
    unanswered,
    /** When the agent last answered in each channel: a post, a reply or a reaction. */
    answered: new Map<string, Temporal.Instant>(),
  });
};

export type ChatContext = ContextOf<ReturnType<typeof chatContext>>;
