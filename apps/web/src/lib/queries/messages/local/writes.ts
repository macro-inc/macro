import { ThrownResultError } from '@core/util/result';
import {
  executeOptimisticMutation,
  type OptimisticResponse,
  optimisticMutationDispositionOf,
} from '@graphql-cache/exchange/optimistic';
import type { CacheHost } from '@graphql-cache/index';
import type { MutationSettlement } from '@graphql-cache/protocol';
import { Telemetry } from '@macro-inc/observability';
import {
  type ChannelMessageFieldsFragment,
  DeleteChannelMessageDocument,
  type DeleteChannelMessageMutation,
  EditChannelMessageDocument,
  type EditChannelMessageMutation,
  ReactToChannelMessageDocument,
  type ReactToChannelMessageMutation,
  SendChannelMessageDocument,
  type SendChannelMessageMutation,
} from '@service-storage/graphql/generated/graphql';
import { getGraphqlSoupClient } from '@service-storage/graphql-soup';
import type { Message, PostMessage } from '@service-storage/messages';
import { onlineManager } from '@tanstack/solid-query';
import type {
  AnyVariables,
  Client,
  CombinedError,
  OperationResult,
} from '@urql/core';
import { ResultAsync } from 'neverthrow';
import { mapChannelMessage } from './map';
import {
  CHANNEL_MESSAGE_TYPENAME,
  liveReplySortKey,
  rootSortKey,
} from './sort-key';
import { loadChannelMessage } from './thread';

/**
 * Channel message hooks run their `mutationFn` while offline when the device
 * queue takes the write: the default mode would pause it in memory, where a
 * reload loses it, before the queue ever saw it.
 */
export function channelWriteNetworkMode(
  host: ChannelWriteHost | undefined
): 'always' | 'online' {
  return host ? 'always' : 'online';
}

/**
 * Waits for a connection, as a paused mutation would: writes that still go
 * over REST from a hook running in `always` mode keep waiting out an outage.
 */
export async function whenOnline(): Promise<void> {
  if (onlineManager.isOnline()) return;
  await new Promise<void>((resolve) => {
    const stop = onlineManager.subscribe((online) => {
      if (!online) return;
      stop();
      resolve();
    });
  });
}

export type ChannelWriteHost = Pick<
  CacheHost,
  'onMutationSettled' | 'onCacheGenerationChanged' | 'readRecordsByKeys'
>;

type Mention = { entity_type: string; entity_id: string };
type Attachment = Mention & { width?: number | null; height?: number | null };
type Reaction = { emoji: string; users: string[] };

export interface ChannelWriteDeps {
  client?: Client;
  /** The device clock, read once per write. */
  now?: () => Date;
}

export interface QueuedChannelSend {
  channelId: string;
  /** Client-minted UUIDv7: the message's id, its nonce and its queue identity. */
  id: string;
  senderId: string;
  message: Pick<
    PostMessage,
    'content' | 'thread_id' | 'mentions' | 'attachments'
  >;
}

export interface QueuedChannelEdit {
  channelId: string;
  id: string;
  content: string;
  mentions: readonly Mention[];
  removeAttachmentIds: readonly string[];
  addAttachments: readonly Attachment[];
  nonce: string;
}

export interface QueuedChannelDelete {
  channelId: string;
  id: string;
  nonce: string;
}

export interface QueuedChannelReaction {
  channelId: string;
  id: string;
  emoji: string;
  add: boolean;
  /** The message's reactions with this change applied, when the caller knows them. */
  reactions?: readonly Reaction[];
  nonce: string;
}

const mentionInput = (mention: Mention) => ({
  entityType: mention.entity_type,
  entityId: mention.entity_id,
});

const attachmentInput = (attachment: Attachment) => ({
  entityType: attachment.entity_type,
  entityId: attachment.entity_id,
  width: attachment.width ?? null,
  height: attachment.height ?? null,
});

/** The refusal in the shape REST failures reach the message hooks in. */
function refusal(code: string | undefined, message: string): ThrownResultError {
  return new ThrownResultError([{ code: code ?? 'UNKNOWN', message }]);
}

function refusalOf(error: CombinedError): ThrownResultError {
  const code = error.graphQLErrors[0]?.extensions.code;
  return refusal(
    typeof code === 'string' ? code : error.networkError && 'NETWORK_ERROR',
    error.message
  );
}

/**
 * Collects the queue's settlements from before the write is handed over, so
 * one that lands between the queue's answer and the wait is not missed.
 */
function watchSettlements(host: ChannelWriteHost) {
  const settled = new Map<string, MutationSettlement>();
  let wake: (() => void) | undefined;
  let reset = false;
  const stopSettled = host.onMutationSettled((settlement) => {
    settled.set(settlement.transactionId, settlement);
    wake?.();
  });
  // A storage reset empties the queue: the write is gone and will not settle.
  const stopReset = host.onCacheGenerationChanged((change) => {
    if (change.storage !== 'reset') return;
    reset = true;
    wake?.();
  });
  return {
    stop() {
      stopSettled();
      stopReset();
    },
    /** Resolves once the transaction, or the one that replaced it, commits. */
    async committed(transactionId: string): Promise<void> {
      let current = transactionId;
      for (;;) {
        if (reset) throw refusal('CACHE_RESET', 'device cache was reset');
        const settlement = settled.get(current);
        if (!settlement) {
          await new Promise<void>((resolve) => {
            wake = resolve;
          });
          continue;
        }
        if (settlement.status === 'committed') return;
        if (settlement.status === 'permanently-failed') {
          throw refusal(settlement.errorCode, settlement.error);
        }
        current = settlement.replacementTransactionId;
      }
    },
  };
}

interface QueuedWrite<TData, TVariables extends AnyVariables> {
  operation: string;
  channelId: string;
  messageId: string;
  /** Hands the write to the queue. */
  run: (client: Client) => Promise<OperationResult<TData, TVariables>>;
  /** The written message in a response the server answered directly. */
  written: (data: TData) => ChannelMessageFieldsFragment;
  /** The row to answer with when a delivered write cannot be read back. */
  predicted?: ChannelMessageFieldsFragment;
}

/** The delivered message as the device holds it, or the row it was sent as. */
async function deliveredMessage(
  host: ChannelWriteHost,
  write: Pick<
    QueuedWrite<unknown, AnyVariables>,
    'channelId' | 'messageId' | 'predicted'
  >
): Promise<Message> {
  const stored = await ResultAsync.fromPromise(
    loadChannelMessage(host, write.channelId, write.messageId),
    (error) => error
  );
  const message = stored.unwrapOr(null) ?? write.predicted;
  // The write is on the server; failing here would roll back a sent message.
  if (!message) throw refusal('NOT_FOUND', 'message not found');
  return mapChannelMessage(message);
}

/**
 * Runs one write through the device's durable queue and resolves with the
 * stored message. A write the queue holds (offline, or behind an older write)
 * stays pending until the queue delivers it; a refusal rejects, after the
 * queue has already rolled the device's copy back.
 */
async function queuedWrite<TData, TVariables extends AnyVariables>(
  host: ChannelWriteHost,
  deps: ChannelWriteDeps,
  write: QueuedWrite<TData, TVariables>
): Promise<Message> {
  const settlements = watchSettlements(host);
  try {
    // The span covers the hand-off and a direct answer; a queued write can
    // wait for hours, which is not this operation's duration.
    const result = await Telemetry.span(write.operation, async (span) => {
      span.setAttr('channel.id', write.channelId);
      span.setAttr('message.id', write.messageId);
      const answer = await write.run(deps.client ?? getGraphqlSoupClient());
      span.setAttr(
        'write.disposition',
        optimisticMutationDispositionOf(answer)?.kind ?? 'direct'
      );
      return answer;
    });
    const disposition = optimisticMutationDispositionOf(result);
    if (disposition?.kind === 'queued') {
      await settlements.committed(disposition.transactionId);
      return await deliveredMessage(host, write);
    }
    if (result.error) throw refusalOf(result.error);
    if (!result.data) throw refusal(undefined, 'empty response');
    return mapChannelMessage(write.written(result.data));
  } finally {
    settlements.stop();
  }
}

/**
 * The row the device shows until the server's copy replaces it. It carries the
 * position the server will give it, so the timeline does not reorder on commit.
 */
function predictedMessage(
  send: QueuedChannelSend,
  createdAt: string
): ChannelMessageFieldsFragment | undefined {
  const threadId = send.message.thread_id ?? null;
  const sortKey = threadId
    ? liveReplySortKey(createdAt, send.id)
    : rootSortKey(createdAt, send.id);
  if (!sortKey) return undefined;
  return {
    __typename: CHANNEL_MESSAGE_TYPENAME,
    id: send.id,
    channelId: send.channelId,
    threadId,
    kind: 'MESSAGE',
    sortKey,
    senderId: send.senderId,
    guestName: null,
    importedAuthorName: null,
    botProfile: null,
    mentions: (send.message.mentions ?? []).map(mentionInput),
    triggeredBy: null,
    triggeredVia: null,
    content: send.message.content,
    createdAt,
    updatedAt: createdAt,
    editedAt: null,
    deletedAt: null,
    attachments: (send.message.attachments ?? []).map((attachment, index) => ({
      // The server mints attachment ids; these last until its copy arrives.
      attachmentId: `${send.id}:${index}`,
      entityType: attachment.entity_type,
      entityId: attachment.entity_id,
      width: attachment.width ?? null,
      height: attachment.height ?? null,
      createdAt,
    })),
    reactions: [],
    thread: threadId
      ? null
      : {
          resolved: false,
          deletedAt: null,
          createdAt,
          updatedAt: createdAt,
          userId: send.senderId,
          replyCount: 0,
          latestReplyAt: null,
          preview: [],
        },
    call: null,
  };
}

/**
 * Posts a channel message through the queue. The id makes a resend after a
 * lost response return the stored message instead of posting twice.
 */
export function sendChannelMessage(
  host: ChannelWriteHost,
  send: QueuedChannelSend,
  deps: ChannelWriteDeps = {}
): Promise<Message> {
  const createdAt = (deps.now?.() ?? new Date()).toISOString();
  const predicted = predictedMessage(send, createdAt);
  return queuedWrite(host, deps, {
    operation: 'channel.write.send',
    channelId: send.channelId,
    messageId: send.id,
    predicted,
    run: (client) =>
      executeOptimisticMutation(
        client,
        SendChannelMessageDocument,
        {
          input: {
            channelId: send.channelId,
            id: send.id,
            content: send.message.content,
            threadId: send.message.thread_id ?? null,
            mentions: (send.message.mentions ?? []).map(mentionInput),
            attachments: (send.message.attachments ?? []).map(attachmentInput),
            nonce: send.id,
          },
        },
        (predicted
          ? { sendChannelMessage: predicted }
          : {}) as OptimisticResponse<SendChannelMessageMutation>,
        { uuid: send.id }
      ).toPromise(),
    written: (data) => data.sendChannelMessage,
  });
}

/** Edits a message's body, mentions and attachments through the queue. */
export function editChannelMessage(
  host: ChannelWriteHost,
  edit: QueuedChannelEdit,
  deps: ChannelWriteDeps = {}
): Promise<Message> {
  const editedAt = (deps.now?.() ?? new Date()).toISOString();
  return queuedWrite(host, deps, {
    operation: 'channel.write.edit',
    channelId: edit.channelId,
    messageId: edit.id,
    run: (client) =>
      executeOptimisticMutation(
        client,
        EditChannelMessageDocument,
        {
          input: {
            channelId: edit.channelId,
            id: edit.id,
            content: edit.content,
            mentions: edit.mentions.map(mentionInput),
            removeAttachmentIds: [...edit.removeAttachmentIds],
            addAttachments: edit.addAttachments.map(attachmentInput),
            nonce: edit.nonce,
          },
        },
        // Attachments change only once the server answers with their ids.
        {
          editChannelMessage: {
            __typename: CHANNEL_MESSAGE_TYPENAME,
            id: edit.id,
            content: edit.content,
            mentions: edit.mentions.map(mentionInput),
            editedAt,
            updatedAt: editedAt,
          },
        } as OptimisticResponse<EditChannelMessageMutation>,
        { uuid: crypto.randomUUID() }
      ).toPromise(),
    written: (data) => data.editChannelMessage,
  });
}

/** Deletes a message through the queue; deleting it again returns the tombstone. */
export function deleteChannelMessage(
  host: ChannelWriteHost,
  deletion: QueuedChannelDelete,
  deps: ChannelWriteDeps = {}
): Promise<Message> {
  const deletedAt = (deps.now?.() ?? new Date()).toISOString();
  return queuedWrite(host, deps, {
    operation: 'channel.write.delete',
    channelId: deletion.channelId,
    messageId: deletion.id,
    run: (client) =>
      executeOptimisticMutation(
        client,
        DeleteChannelMessageDocument,
        {
          input: {
            channelId: deletion.channelId,
            id: deletion.id,
            nonce: deletion.nonce,
          },
        },
        {
          deleteChannelMessage: {
            __typename: CHANNEL_MESSAGE_TYPENAME,
            id: deletion.id,
            deletedAt,
            updatedAt: deletedAt,
          },
        } as OptimisticResponse<DeleteChannelMessageMutation>,
        { uuid: crypto.randomUUID() }
      ).toPromise(),
    written: (data) => data.deleteChannelMessage,
  });
}

/** Adds or removes the person's reaction through the queue. */
export function reactToChannelMessage(
  host: ChannelWriteHost,
  reaction: QueuedChannelReaction,
  deps: ChannelWriteDeps = {}
): Promise<Message> {
  return queuedWrite(host, deps, {
    operation: 'channel.write.react',
    channelId: reaction.channelId,
    messageId: reaction.id,
    run: (client) =>
      executeOptimisticMutation(
        client,
        ReactToChannelMessageDocument,
        {
          input: {
            channelId: reaction.channelId,
            id: reaction.id,
            emoji: reaction.emoji,
            add: reaction.add,
            nonce: reaction.nonce,
          },
        },
        {
          reactToChannelMessage: {
            __typename: CHANNEL_MESSAGE_TYPENAME,
            id: reaction.id,
            ...(reaction.reactions && {
              reactions: reaction.reactions.map(({ emoji, users }) => ({
                emoji,
                users: [...users],
              })),
            }),
          },
        } as OptimisticResponse<ReactToChannelMessageMutation>,
        { uuid: crypto.randomUUID() }
      ).toPromise(),
    written: (data) => data.reactToChannelMessage,
  });
}
