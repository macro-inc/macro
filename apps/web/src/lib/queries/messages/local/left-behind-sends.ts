import { thrownResultErrorHasCode } from '@core/util/result';
import { sleep } from '@core/util/sleep';
import { entityMessagesClient } from '@service-storage/messages';
import { refreshChannelViews } from './catch-up';
import {
  forgetUnqueuedSend,
  type UnqueuedSend,
  type UnqueuedSendsHost,
} from './unqueued-sends';
import { whenOnline } from './writes';

/** How long the device queue has to say what it holds before a post goes out. */
export const QUEUE_ANSWER_WAIT_MS = 5_000;

type QueuedMutations = Awaited<
  ReturnType<NonNullable<UnqueuedSendsHost['inspectMutations']>>
>;

export interface LeftBehindSendDeps {
  post?: typeof entityMessagesClient.post;
  online?: () => Promise<void>;
  forget?: typeof forgetUnqueuedSend;
  refresh?: typeof refreshChannelViews;
}

/**
 * The device queue as far as it answers in time. A queue that is missing,
 * failing or still starting is taken to hold nothing, so the REST post never
 * waits on the cache: a send the queue does hold is answered by the server as
 * already stored, whichever of the two reaches it second.
 */
export function queueIfAnswering(
  host: UnqueuedSendsHost | undefined,
  waitMs = QUEUE_ANSWER_WAIT_MS
): UnqueuedSendsHost {
  return {
    inspectMutations: async () => {
      try {
        return await Promise.race([held(host), nothingAfter(waitMs)]);
      } catch {
        return [];
      }
    },
  };
}

async function held(
  host: UnqueuedSendsHost | undefined
): Promise<QueuedMutations> {
  return (await host?.inspectMutations?.()) ?? [];
}

async function nothingAfter(waitMs: number): Promise<QueuedMutations> {
  await sleep(waitMs);
  return [];
}

/**
 * Posts over REST a send an earlier page noted for the device queue and never
 * saw stored, for a page where channels no longer go through the queue. The
 * message keeps its id, so a send the queue did deliver after all is answered
 * as already stored. The channel's open views read again, since no hook is
 * left to place the message. A send that fails stays noted for the next start.
 */
export async function sendLeftBehindOverRest(
  send: UnqueuedSend,
  deps: LeftBehindSendDeps = {}
): Promise<void> {
  await (deps.online ?? whenOnline)();
  try {
    await (deps.post ?? entityMessagesClient.post)(
      { type: 'channel', id: send.channelId },
      { ...send.message, id: send.id, nonce: send.id }
    );
  } catch (error) {
    if (!thrownResultErrorHasCode(error, 'CONFLICT')) throw error;
  }
  (deps.forget ?? forgetUnqueuedSend)(send.senderId, send.id);
  (deps.refresh ?? refreshChannelViews)(send.channelId);
}
