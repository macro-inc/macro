import { behavior, type ContextOf } from '@macro-inc/muppet/core/behavior';
import { channel } from '@macro-inc/muppet/core/event';
import { z } from 'zod';
import type { Base } from '../../context/index.ts';
import { batches } from '../../context/stream.ts';
import type { Conversation, Queued } from './entry.ts';
import { history } from './history.ts';
import { Screen } from './listen.ts';
import { sdkChat } from './macro.ts';
import { typing } from './typing.ts';

/** The owner of chat's state directories. */
export const owner = 'chat';

const historyDirectory = 'history';
const screenModule = z.object({ screen: Screen });
/** The screen's file, beside this one. */
const screenFile = 'screen.ts';
const queueDirectory = 'queue';

/** What chat adds to the agent's context: Macro, what it remembers of conversations, and who is waiting on it. */
export const chatContext = ({ macro, config, state, join, disk }: Base) => {
  const chat = sdkChat({ macro, myName: config.identity.name });
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
