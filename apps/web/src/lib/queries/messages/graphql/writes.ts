import { fireAndForget } from '@core/util/fireAndForget';
import { ThrownResultError } from '@core/util/result';
import {
  executeOptimisticMutation,
  optimisticMutationDispositionOf,
} from '@graphql-cache/exchange/optimistic';
import type { CacheHost } from '@graphql-cache/host/types';
import type { MutationSettlement } from '@graphql-cache/protocol';
import { Telemetry, type TraceContext } from '@macro-inc/observability';
import type { NewAttachment } from '@service-storage/generated/schemas/newAttachment';
import type { SimpleMention } from '@service-storage/generated/schemas/simpleMention';
import {
  type ChannelMessageWriteFieldsFragment,
  DeleteChannelMessageDocument,
  EditChannelMessageDocument,
  type GraphqlChannelAttachmentInput,
  PostChannelMessageDocument,
  ReactToChannelMessageDocument,
} from '@service-storage/graphql/generated/graphql';
import type {
  Message as EntityMessage,
  MessageAttachment,
  MessageParent,
} from '@service-storage/messages';
import type { AnyVariables, OperationResult } from '@urql/core';
import { v5 as uuidv5 } from 'uuid';
import { getTargetMessage, resolveMessageTarget } from '../reconcile';
import { messageFromGraphql } from './convert';
import {
  channelWriteMessageId,
  channelWriteMetadata,
  channelWriteParent,
  expectLiveChannelWrite,
  holdQueuedChannelWrite,
  type QueuedChannelWrite,
  refreshAfterChannelWrite,
  releaseQueuedChannelWrite,
} from './queued-writes';
import { channelCacheHost, channelWriteClient, readError } from './source';

/** Namespace of the queue keys edits share, one per message. */
const EDIT_KEY_NAMESPACE = '0b9c3a52-7d1e-4f0a-9a63-5c2e8f4b7d10';

/**
 * The cache host a channel message write is queued through, or `undefined`
 * for one that goes over REST: any other parent, or a channel read from REST.
 */
export function channelWriteHost(parent: MessageParent): CacheHost | undefined {
  return parent.type === 'channel' ? channelCacheHost() : undefined;
}

/**
 * The queue key of a write. A post's is its message id, so a resend is the
 * same write. Every edit of a message shares one, so a newer edit replaces an
 * unsent one. Deletes and reactions each get their own.
 */
function channelWriteUuid(write: QueuedChannelWrite): string {
  switch (write.kind) {
    case 'post':
      return write.input.id;
    case 'edit':
      return uuidv5(String(write.input.messageId), EDIT_KEY_NAMESPACE);
    case 'delete':
    case 'react':
      return crypto.randomUUID();
  }
}

function mentionsToGraphql(mentions: readonly SimpleMention[] | undefined) {
  return (mentions ?? []).map((mention) => ({
    entityId: mention.entity_id,
    entityType: mention.entity_type,
  }));
}

function attachmentToGraphql(
  attachment: NewAttachment | MessageAttachment
): GraphqlChannelAttachmentInput {
  return {
    entityId: attachment.entity_id,
    entityType: attachment.entity_type,
    width: attachment.width ?? null,
    height: attachment.height ?? null,
  };
}

export function postWrite(args: {
  channelId: string;
  messageId: string;
  senderId: string;
  content: string;
  mentions?: readonly SimpleMention[];
  attachments?: readonly NewAttachment[];
  threadId?: string | null;
}): QueuedChannelWrite {
  return {
    kind: 'post',
    input: {
      channelId: args.channelId,
      id: args.messageId,
      content: args.content,
      mentions: mentionsToGraphql(args.mentions),
      attachments: (args.attachments ?? []).map(attachmentToGraphql),
      threadId: args.threadId ?? null,
      // The server echoes it on the message's event, which the sender skips.
      nonce: args.messageId,
    },
    senderId: args.senderId,
  };
}

/**
 * An edit as the editor made it: attachment changes are against the message
 * it showed. The queue sends them as the whole list the message ends with,
 * named by entity: a message still queued holds attachments with ids the
 * server never gave out.
 */
export function editWrite(args: {
  parent: MessageParent;
  messageId: string;
  content: string;
  mentions: readonly SimpleMention[];
  attachmentIdsToDelete?: readonly string[];
  attachmentsToAdd?: readonly NewAttachment[];
  nonce: string;
}): QueuedChannelWrite {
  const removed = new Set(args.attachmentIdsToDelete ?? []);
  const added = args.attachmentsToAdd ?? [];
  const changesAttachments = removed.size > 0 || added.length > 0;
  const shown = changesAttachments
    ? getTargetMessage(
        args.parent,
        resolveMessageTarget({ parent: args.parent, messageId: args.messageId })
      )
    : undefined;
  return {
    kind: 'edit',
    input: {
      channelId: args.parent.id,
      messageId: args.messageId,
      content: args.content,
      mentions: mentionsToGraphql(args.mentions),
      ...(!changesAttachments
        ? {}
        : shown
          ? {
              attachments: {
                replace: [
                  ...shown.attachments.filter(
                    (attachment) => !removed.has(attachment.id)
                  ),
                  ...added,
                ].map(attachmentToGraphql),
              },
            }
          : {
              attachments: {
                delta: {
                  remove: [...removed],
                  add: added.map(attachmentToGraphql),
                },
              },
            }),
      nonce: args.nonce,
    },
  };
}

/** A queued channel write's answer as the hook sees it. */
type WriteAnswer =
  | { kind: 'committed'; message: EntityMessage }
  | { kind: 'queued'; transactionId: string }
  | { kind: 'failed'; error: unknown };

function answerOf<TData, TVariables extends AnyVariables>(
  result: OperationResult<TData, TVariables>,
  field: (data: TData) => ChannelMessageWriteFieldsFragment
): WriteAnswer {
  const disposition = optimisticMutationDispositionOf(result);
  if (disposition?.kind === 'queued')
    return { kind: 'queued', transactionId: disposition.transactionId };
  if (disposition?.kind === 'permanently-failed')
    return { kind: 'failed', error: readError(disposition.error) };
  // Without a disposition the queue's answer is not known: the write may or
  // may not be queued, and is reported as failed.
  if (result.error) return { kind: 'failed', error: readError(result.error) };
  if (result.data == null)
    return {
      kind: 'failed',
      error: new Error('Channel write returned no data'),
    };
  return {
    kind: 'committed',
    message: messageFromGraphql(field(result.data).message),
  };
}

async function enqueue(
  write: QueuedChannelWrite,
  uuid: string
): Promise<WriteAnswer> {
  const client = channelWriteClient();
  // Only the timeline holds the write's optimistic change: the queue keeps
  // none, so a committed response is the only change it makes to the cache.
  const options = { uuid, clientMetadata: channelWriteMetadata(write) };
  switch (write.kind) {
    case 'post':
      return answerOf(
        await executeOptimisticMutation(
          client,
          PostChannelMessageDocument,
          { input: write.input },
          {},
          options
        ).toPromise(),
        (data) => data.postChannelMessage
      );
    case 'edit':
      return answerOf(
        await executeOptimisticMutation(
          client,
          EditChannelMessageDocument,
          { input: write.input },
          {},
          options
        ).toPromise(),
        (data) => data.editChannelMessage
      );
    case 'delete':
      return answerOf(
        await executeOptimisticMutation(
          client,
          DeleteChannelMessageDocument,
          { input: write.input },
          {},
          options
        ).toPromise(),
        (data) => data.deleteChannelMessage
      );
    case 'react':
      return answerOf(
        await executeOptimisticMutation(
          client,
          ReactToChannelMessageDocument,
          { input: write.input },
          {},
          options
        ).toPromise(),
        (data) => data.reactToChannelMessage
      );
  }
}

/** The settlements a write's wait reads, heard from before it is enqueued. */
function listen(host: CacheHost) {
  const settlements = new Map<string, MutationSettlement>();
  let reset = false;
  let wake: (() => void) | undefined;
  const stopSettled = host.onMutationSettled((settlement) => {
    settlements.set(settlement.transactionId, settlement);
    wake?.();
  });
  const stopReset = host.onCacheGenerationChanged((change) => {
    if (change.storage !== 'reset') return;
    reset = true;
    wake?.();
  });
  return {
    async settled(
      transactionId: string
    ): Promise<MutationSettlement | 'reset'> {
      for (;;) {
        if (reset) return 'reset';
        const settlement = settlements.get(transactionId);
        if (settlement) return settlement;
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
        wake = undefined;
      }
    },
    stop() {
      stopSettled();
      stopReset();
    },
  };
}

/** Writes started on this page, in the order they were typed. */
let writeOrder = 0;

/**
 * Send a channel message write through the queue. A write the server took
 * at once resolves with its message. A queued one resolves once it commits,
 * with nothing: its change reaches the timeline by its number, or by reading
 * the channel again. One replaced by a newer write of the same message
 * resolves with nothing too. A refusal, or the queue lost with the cache,
 * rejects.
 */
async function sendChannelWrite(
  host: CacheHost,
  write: QueuedChannelWrite,
  context: TraceContext
): Promise<EntityMessage | undefined> {
  const order = ++writeOrder;
  // When the person sent it: the cache can take a while to hold it.
  const startedAtMs = Date.now();
  const uuid = channelWriteUuid(write);
  const settlements = listen(host);
  const forget = expectLiveChannelWrite(uuid);
  try {
    const answer = await context.run(() => enqueue(write, uuid));
    if (answer.kind === 'committed') return answer.message;
    if (answer.kind === 'failed') throw answer.error;
    return await context.run(() =>
      waitForQueuedWrite(
        host,
        write,
        answer.transactionId,
        { order, startedAtMs },
        settlements
      )
    );
  } finally {
    settlements.stop();
    forget();
  }
}

function waitForQueuedWrite(
  host: CacheHost,
  write: QueuedChannelWrite,
  transactionId: string,
  started: { order: number; startedAtMs: number },
  settlements: ReturnType<typeof listen>
): Promise<EntityMessage | undefined> {
  const parent = channelWriteParent(write);
  return Telemetry.span('channel.write_wait', async (span) => {
    span.setAttr('channel.id', parent.id);
    span.setAttr('message.id', channelWriteMessageId(write));
    span.setAttr('channel.write.kind', write.kind);
    holdQueuedChannelWrite(host, transactionId, write, {
      live: true,
      ...started,
    });
    let settlement: MutationSettlement | 'reset';
    try {
      settlement = await settlements.settled(transactionId);
    } finally {
      releaseQueuedChannelWrite(transactionId);
    }
    if (settlement === 'reset') {
      span.setAttr('channel.write.outcome', 'reset');
      span.error('Queued channel write lost with the cache');
      throw new Error('The queued channel write was lost with the cache');
    }
    span.setAttr('channel.write.outcome', settlement.status);
    if (settlement.status === 'permanently-failed') {
      span.error('Queued channel write failed');
      throw new ThrownResultError([
        {
          code: settlement.errorCode ?? 'INTERNAL_SERVER_ERROR',
          message: settlement.error,
        },
      ]);
    }
    // A replaced write's change is its replacement's to bring.
    if (settlement.status === 'committed') refreshAfterChannelWrite(parent);
    return undefined;
  });
}

const started = new WeakMap<object, Promise<EntityMessage | undefined>>();

/**
 * Start a write through the queue. A hook calls it from `onMutate`, which
 * runs while the device is offline: `mutationFn` waits for the connection,
 * and a write that waited there would be lost with the page.
 */
export function startChannelWrite(
  variables: object,
  host: CacheHost,
  write: QueuedChannelWrite
) {
  const sent = sendChannelWrite(host, write, Telemetry.captureContext());
  fireAndForget(unreported(sent), 'channel-writes');
  started.set(variables, sent);
}

/**
 * Wait out a write whose hook reports its failure: a hook that never reached
 * `mutationFn` has nothing to report it to.
 */
async function unreported(sent: Promise<unknown>) {
  try {
    await sent;
  } catch {
    // Reported by the hook that awaits the same write.
  }
}

/** The queued write a hook's `onMutate` started for these variables, if any. */
export function startedChannelWrite(
  variables: object
): Promise<EntityMessage | undefined> | undefined {
  return started.get(variables);
}
