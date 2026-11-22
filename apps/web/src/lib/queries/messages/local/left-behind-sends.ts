import { thrownResultErrorHasCode } from '@core/util/result';
import { sleep } from '@core/util/sleep';
import { entityMessagesClient } from '@service-storage/messages';
import { match } from 'ts-pattern';
import { refreshChannelViews } from './catch-up';
import {
  forgetUnqueuedSend,
  type UnqueuedChange,
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
  client?: Pick<typeof entityMessagesClient, 'patch' | 'delete' | 'react'>;
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

/** Answers that say the message is gone, not the person's, or already changed. */
const REFUSALS = ['NOT_FOUND', 'FORBIDDEN', 'CONFLICT'];

/**
 * Makes over REST an edit, a removal or a reaction an earlier page noted for
 * the device queue and never saw stored, for a page where channels no longer
 * go through the queue. A removal is taken once; an edit or a reaction the
 * queue did deliver after all is applied again with the same result, and an
 * edit that adds an attachment may add it twice, since REST has no once-only
 * way to add one. Changes are made again for minutes only (`unqueued-sends`). A change the server refuses is forgotten, since
 * no later start would fare better; any other failure leaves it noted for the
 * next start.
 */
export async function changeLeftBehindOverRest(
  change: UnqueuedChange,
  deps: LeftBehindSendDeps = {}
): Promise<void> {
  await (deps.online ?? whenOnline)();
  const client = deps.client ?? entityMessagesClient;
  const parent = { type: 'channel' as const, id: change.channelId };
  try {
    await match(change)
      .with({ kind: 'edit' }, (edit) =>
        client.patch(parent, edit.id, {
          content: edit.content,
          mentions: edit.mentions,
          attachments: {
            type: 'delta',
            value: {
              remove: edit.removeAttachmentIds,
              add: edit.addAttachments,
            },
          },
          nonce: edit.nonce,
        })
      )
      .with({ kind: 'delete' }, (deletion) =>
        client.delete(parent, deletion.id, deletion.nonce)
      )
      .with({ kind: 'react' }, (reaction) =>
        client.react(
          parent,
          reaction.id,
          reaction.emoji,
          reaction.add,
          reaction.nonce
        )
      )
      .exhaustive();
  } catch (error) {
    if (!REFUSALS.some((code) => thrownResultErrorHasCode(error, code)))
      throw error;
  }
  (deps.forget ?? forgetUnqueuedSend)(change.senderId, change.uuid);
  (deps.refresh ?? refreshChannelViews)(change.channelId);
}

/**
 * Runs each piece of work once the one before it has ended, however it ended.
 * Left-behind writes go to the server in the order written: a removal sent
 * beside the post of its message could arrive first and be refused, and the
 * message would stay.
 */
export function oneAfterAnother(): (
  work: () => Promise<void>
) => Promise<void> {
  let last: Promise<unknown> = Promise.resolve();
  return (work) => {
    const before = last;
    const run = (async () => {
      await Promise.allSettled([before]);
      await work();
    })();
    last = run;
    return run;
  };
}
