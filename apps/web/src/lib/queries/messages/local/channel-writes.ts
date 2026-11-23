import { fireAndForget } from '@core/util/fireAndForget';
import { ThrownResultError, thrownResultErrorHasCode } from '@core/util/result';
import {
  executeOptimisticMutation,
  type OptimisticResponse,
  optimisticMutationDispositionOf,
} from '@graphql-cache/exchange/optimistic';
import type { CacheGenerationChange } from '@graphql-cache/host/types';
import type { CacheHost } from '@graphql-cache/index';
import type { MutationSettlement } from '@graphql-cache/protocol';
import { Telemetry, type TraceContext } from '@macro-inc/observability';
import {
  ChannelMessageDocument,
  type ChannelMessageFieldsFragment,
  type ChannelMessageWriteFieldsFragment,
  DeleteChannelMessageDocument,
  type DeleteChannelMessageMutation,
  EditChannelMessageDocument,
  type EditChannelMessageMutation,
  ReactToChannelMessageDocument,
  type ReactToChannelMessageMutation,
  SendChannelMessageDocument,
  type SendChannelMessageMutation,
} from '@service-storage/graphql/generated/graphql';
import type { Message, PostMessage } from '@service-storage/messages';
import { onlineManager } from '@tanstack/solid-query';
import type {
  AnyVariables,
  Client,
  CombinedError,
  OperationResult,
} from '@urql/core';
import * as Deferred from 'effect/Deferred';
import * as Effect from 'effect/Effect';
import { createStore, produce } from 'solid-js/store';
import {
  CHANNEL_MESSAGE_TYPENAME,
  channelMessageKey,
  mapChannelMessage,
  mapChannelTimelineEntry,
  unplacedSortKey,
} from './channel-map';
import { queryChannelNetwork } from './channel-network';
import type { ChannelPageEntry } from './channel-pages';
import { readTimelineRecords } from './channel-pages';
import type { ChannelSyncRuntime } from './channel-sync-runtime';

const WRITE_TYPENAME = 'GraphqlChannelMessageWrite';
const SEND_OPERATION = 'channel.write.send';
/** The queue's code for a write it stopped retrying. */
const RETRY_EXHAUSTED = 'MUTATION_RETRY_EXHAUSTED';

/** Reads one message from the server; null when the server does not have it. */
export type FetchChannelMessage = (
  channelId: string,
  messageId: string
) => Promise<ChannelMessageFieldsFragment | null>;

const fetchServerMessage: FetchChannelMessage = async (
  channelId,
  messageId
) => {
  const { data, cached } = await queryChannelNetwork(ChannelMessageDocument, {
    channelId,
    messageId,
  });
  // The views reread when the write ends, so the device should hold it then;
  // a copy that could not be stored is still the answer.
  try {
    await cached;
  } catch (error) {
    Telemetry.error(error, { surface: 'channel-writes' });
  }
  return data.user.channelMessage;
};

/**
 * Writes through the device queue run offline too: the queue holds them until
 * the connection returns. Writes over REST wait for a connection.
 */
export function channelWriteNetworkMode(
  host: CacheHost | undefined
): 'always' | 'online' {
  return host ? 'always' : 'online';
}

/**
 * Waits for a connection, as a paused mutation would: a REST write from a hook
 * running in `always` mode keeps waiting out an outage.
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
  | 'onMutationSettled'
  | 'onCacheGenerationChanged'
  | 'readRecordsByKeys'
  | 'inspectMutations'
>;

type Mention = { entity_type: string; entity_id: string };
type Attachment = Mention & { width?: number | null; height?: number | null };
type Reaction = { emoji: string; users: string[] };

export interface ChannelSend {
  channelId: string;
  /** From `newMessageId`: the message's id, its nonce and its queue identity. */
  id: string;
  senderId: string;
  message: Pick<
    PostMessage,
    'content' | 'thread_id' | 'mentions' | 'attachments'
  >;
}

export interface ChannelEdit {
  channelId: string;
  id: string;
  content: string;
  mentions: readonly Mention[];
  removeAttachmentIds: readonly string[];
  addAttachments: readonly Attachment[];
  nonce: string;
}

export interface ChannelDelete {
  channelId: string;
  id: string;
  nonce: string;
}

export interface ChannelReaction {
  channelId: string;
  id: string;
  emoji: string;
  add: boolean;
  /** The message's reactions with this change applied, when the caller knows them. */
  reactions?: readonly Reaction[];
  nonce: string;
}

export interface ChannelWritesDeps {
  host: ChannelWriteHost;
  runtime: Pick<ChannelSyncRuntime, 'notifyChanged'>;
  client: () => Pick<Client, 'mutation'>;
  /** The device clock, read once per write. */
  now?: () => Date;
  /** Reads a message from the server, to learn whether a send arrived. */
  fetchMessage?: FetchChannelMessage;
}

/** A reply this page sent, under its thread root. */
type UnstoredReply = { rootId: string; message: Message };

type PendingWrite = {
  uuid: string;
  /** A root this device sent that the device does not show yet. */
  unstored?: ChannelPageEntry;
  /** A reply this device sent, shown in its thread until the device has it. */
  reply?: UnstoredReply;
};

export interface ChannelWrites {
  send(send: ChannelSend): Promise<Message>;
  edit(edit: ChannelEdit): Promise<Message>;
  remove(deletion: ChannelDelete): Promise<Message>;
  react(reaction: ChannelReaction): Promise<Message>;
  /** Writes this page made to the channel that have not reached the server. */
  pendingCount(channelId: string): number;
  /**
   * Roots this page sent that the device has not stored yet, newest first:
   * the device's queue can take seconds to store a write, and the message is
   * on screen from the moment it is sent.
   */
  unstoredRoots: (channelId: string) => ChannelPageEntry[];
  /** Replies this page sent to a thread, oldest first, the same way. */
  unstoredReplies: (channelId: string, rootId: string) => Message[];
  /**
   * The host is retiring and will settle nothing more: fail every write still
   * waiting for the queue, as a storage reset does, instead of leaving it
   * pending for good.
   */
  retire(): void;
}

/** Ends a settlement wait with the refusal it carries. */
type Lost = Deferred.Deferred<never, ThrownResultError>;

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
 * Waits for the queue to settle a transaction, or the one that replaced it.
 * Listening starts before the write is handed over, so a settlement that lands
 * between the queue's answer and the wait is not missed. A retired host
 * (`retired`, from `ChannelWrites.retire`) reports nothing more, so each wait
 * races that.
 *
 * A page the browser suspended (the back/forward cache) hears no settlement
 * while away, and another tab can deliver its write meanwhile. A host that
 * comes back cannot tell what changed while it was frozen and may report a
 * reset with its storage intact. So after any generation change, heard
 * before or during the wait, the queue is asked: a write it still holds keeps
 * waiting, and one that left it unheard ends as `missed`, whose outcome the
 * caller reads from the device and then the server. A reset whose queue
 * cannot be asked loses the write (`CACHE_RESET`).
 */
function watchSettlements(host: ChannelWriteHost, retired: Lost) {
  const settlements = new Map<string, Deferred.Deferred<MutationSettlement>>();
  const reset: Lost = Deferred.makeUnsafe();
  const missed = Deferred.makeUnsafe<'missed'>();
  let waiting: string | undefined;
  // A generation change heard before the wait had a transaction to check.
  let unchecked: CacheGenerationChange['storage'] | undefined;
  const lost = () =>
    Deferred.doneUnsafe(
      reset,
      Effect.fail(refusal('CACHE_RESET', 'device cache was reset'))
    );
  /**
   * After the engine comes back, with its storage kept or (as a host that
   * was suspended conservatively reports) reset, asks the queue: a write it
   * still holds keeps waiting, and one that left it unheard is `missed`.
   * Without an answer, a reset loses the write.
   */
  const checkQueued = async (storage: CacheGenerationChange['storage']) => {
    const transactionId = waiting;
    if (!transactionId) {
      if (storage === 'reset' || !unchecked) unchecked = storage;
      return;
    }
    let queue: Awaited<
      ReturnType<NonNullable<ChannelWriteHost['inspectMutations']>>
    >;
    try {
      if (!host.inspectMutations) throw new Error('queue cannot be listed');
      queue = await host.inspectMutations();
    } catch (error) {
      if (storage === 'reset') lost();
      else Telemetry.error(error, { surface: 'channel-writes' });
      return;
    }
    if (waiting !== transactionId) return;
    if (queue.some((entry) => entry.transactionId === transactionId)) return;
    Deferred.doneUnsafe(missed, Effect.succeed('missed' as const));
  };
  const settlementOf = (transactionId: string) => {
    let deferred = settlements.get(transactionId);
    if (!deferred) {
      deferred = Deferred.makeUnsafe<MutationSettlement>();
      settlements.set(transactionId, deferred);
    }
    return deferred;
  };
  const stopSettled = host.onMutationSettled((settlement) => {
    Deferred.doneUnsafe(
      settlementOf(settlement.transactionId),
      Effect.succeed(settlement)
    );
  });
  const stopReset = host.onCacheGenerationChanged((change) => {
    fireAndForget(checkQueued(change.storage), 'channel-writes');
  });
  const settledOrReset = (transactionId: string) =>
    Effect.raceAllFirst([
      Deferred.await(settlementOf(transactionId)),
      Deferred.await(reset),
      Deferred.await(retired),
      Deferred.await(missed),
    ]);
  const committed = (
    transactionId: string
  ): Effect.Effect<'committed' | 'missed', ThrownResultError> =>
    Effect.gen(function* () {
      waiting = transactionId;
      const heard = unchecked;
      unchecked = undefined;
      if (heard) fireAndForget(checkQueued(heard), 'channel-writes');
      const settlement = yield* settledOrReset(transactionId);
      if (settlement === 'missed') return settlement;
      if (settlement.status === 'committed') return settlement.status;
      if (settlement.status === 'permanently-failed') {
        return yield* Effect.fail(
          refusal(settlement.errorCode, settlement.error)
        );
      }
      return yield* committed(settlement.replacementTransactionId);
    });
  return {
    stop() {
      stopSettled();
      stopReset();
    },
    committed: (transactionId: string): Promise<'committed' | 'missed'> =>
      Effect.runPromise(committed(transactionId)),
  };
}

/**
 * The row the device shows until the server's copy replaces it. It sorts after
 * every message the server has placed, where the server will put it too unless
 * someone else's message arrives first.
 */
export function predictedMessage(
  send: ChannelSend,
  createdAt: string
): ChannelMessageFieldsFragment | undefined {
  const threadId = send.message.thread_id ?? null;
  const sortKey = unplacedSortKey(createdAt, send.id, threadId !== null);
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

/** The root as it will read once the reply is on it. */
export function predictedRoot(
  root: ChannelMessageFieldsFragment,
  reply: ChannelMessageFieldsFragment
): ChannelMessageFieldsFragment {
  if (!root.thread) return root;
  return {
    ...root,
    thread: {
      ...root.thread,
      replyCount: root.thread.replyCount + 1,
      latestReplyAt: reply.createdAt,
      updatedAt: reply.createdAt,
    },
  };
}

interface Write<TData, TVariables extends AnyVariables> {
  operation: string;
  channelId: string;
  messageId: string;
  uuid: string;
  /** Hands the write to the queue. */
  run: (
    client: Pick<Client, 'mutation'>,
    options: { uuid: string; onEnqueued: () => void }
  ) => Promise<OperationResult<TData, TVariables>>;
  /** The write's answer in a response the server answered directly. */
  written: (data: TData) => ChannelMessageWriteFieldsFragment;
  /** The row to answer with when a delivered write cannot be read back. */
  predicted?: ChannelMessageFieldsFragment;
  unstored?: ChannelPageEntry;
  reply?: UnstoredReply;
  /** The trace the write was asked for in, when it awaited before starting. */
  trace?: TraceContext;
}

/**
 * Channel writes through the device's durable queue for one cache host. Each
 * write shows at once (its optimistic record, or until the queue stores it an
 * in-memory row), resolves once the server has it, and rejects after the queue
 * has rolled the device's copy back.
 */
export function createChannelWrites(deps: ChannelWritesDeps): ChannelWrites {
  const [pending, setPending] = createStore<Record<string, PendingWrite[]>>({});
  const retired: Lost = Deferred.makeUnsafe();

  const addPending = (channelId: string, write: PendingWrite) =>
    setPending(
      produce((state) => {
        state[channelId] = [...(state[channelId] ?? []), write];
      })
    );
  const removePending = (channelId: string, uuid: string) =>
    setPending(
      produce((state) => {
        const writes = state[channelId]?.filter((entry) => entry.uuid !== uuid);
        if (writes?.length) state[channelId] = writes;
        else delete state[channelId];
      })
    );

  /** The device's copy of a message; undefined when it cannot be read. */
  async function readMessage(
    id: string
  ): Promise<ChannelMessageFieldsFragment | undefined> {
    let records: Awaited<ReturnType<typeof readTimelineRecords>>;
    try {
      records = await readTimelineRecords(deps.host, [channelMessageKey(id)]);
    } catch (error) {
      Telemetry.error(error, { surface: 'channel-writes' });
      return undefined;
    }
    const record = records?.[0];
    return record?.__typename === CHANNEL_MESSAGE_TYPENAME ? record : undefined;
  }

  async function stored(
    write: Pick<Write<unknown, AnyVariables>, 'messageId' | 'predicted'>
  ): Promise<Message> {
    const message = (await readMessage(write.messageId)) ?? write.predicted;
    // The write is on the server; failing here would roll back a sent message.
    if (!message) throw refusal('NOT_FOUND', 'message not found');
    return mapChannelMessage(message);
  }

  /**
   * The server's copy of a message this page sent; null when the server does
   * not have it, undefined when it could not say. Reading it stores it on the
   * device, so the views show it.
   */
  async function serverCopy(
    write: Pick<Write<unknown, AnyVariables>, 'channelId' | 'messageId'>
  ): Promise<Message | null | undefined> {
    try {
      const message = await (deps.fetchMessage ?? fetchServerMessage)(
        write.channelId,
        write.messageId
      );
      return message && mapChannelMessage(message);
    } catch (error) {
      Telemetry.error(error, { surface: 'channel-writes' });
      return undefined;
    }
  }

  /**
   * A write that left the queue while this page heard nothing. A send is
   * delivered when the device or the server holds it, and was not sent when
   * neither does; other writes resolve with the device's copy, which the
   * views reread.
   */
  async function missedOutcome(
    write: Pick<
      Write<unknown, AnyVariables>,
      'channelId' | 'messageId' | 'operation'
    >
  ): Promise<Message> {
    const message = await readMessage(write.messageId);
    if (message) return mapChannelMessage(message);
    const send = write.operation === SEND_OPERATION;
    const delivered = send ? await serverCopy(write) : undefined;
    if (delivered) return delivered;
    throw refusal(
      send ? 'NOT_SENT' : 'NOT_FOUND',
      'the write left the queue while the page was away'
    );
  }

  /**
   * A send the queue gave up on after retrying it may still have reached the
   * server: a restored draft would go out again under a new id. The server's
   * copy, when it has one, is the send's answer.
   */
  async function deliveredAfterAll(
    write: Pick<
      Write<unknown, AnyVariables>,
      'channelId' | 'messageId' | 'operation'
    >,
    error: unknown
  ): Promise<Message | undefined> {
    if (write.operation !== SEND_OPERATION) return undefined;
    if (!thrownResultErrorHasCode(error, RETRY_EXHAUSTED)) return undefined;
    return (await serverCopy(write)) ?? undefined;
  }

  async function queuedWrite<TData, TVariables extends AnyVariables>(
    write: Write<TData, TVariables>
  ): Promise<Message> {
    const settlements = watchSettlements(deps.host, retired);
    addPending(write.channelId, {
      uuid: write.uuid,
      unstored: write.unstored,
      reply: write.reply,
    });
    deps.runtime.notifyChanged(write.channelId);
    // The optimistic record is on the device: windows read it from here.
    const onEnqueued = () => deps.runtime.notifyChanged(write.channelId);
    try {
      // The span covers the hand-off and a direct answer; a queued write can
      // wait for hours, which is not this operation's duration.
      const traced = <T>(operation: () => T): T =>
        write.trace ? write.trace.run(operation) : operation();
      const result = await traced(() =>
        Telemetry.span(write.operation, async (span) => {
          span.setAttr('channel.id', write.channelId);
          span.setAttr('message.id', write.messageId);
          const answer = await write.run(deps.client(), {
            uuid: write.uuid,
            onEnqueued,
          });
          span.setAttr(
            'write.disposition',
            optimisticMutationDispositionOf(answer)?.kind ?? 'direct'
          );
          return answer;
        })
      );
      const disposition = optimisticMutationDispositionOf(result);
      if (disposition?.kind === 'queued') {
        let outcome: 'committed' | 'missed';
        try {
          outcome = await settlements.committed(disposition.transactionId);
        } catch (error) {
          const delivered = await deliveredAfterAll(write, error);
          if (delivered) return delivered;
          throw error;
        }
        if (outcome === 'missed') return await missedOutcome(write);
        return await stored(write);
      }
      if (result.error) throw refusalOf(result.error);
      if (!result.data) throw refusal(undefined, 'empty response');
      return mapChannelMessage(write.written(result.data).message);
    } finally {
      settlements.stop();
      removePending(write.channelId, write.uuid);
      // Committed or rolled back, the device's copy changed.
      deps.runtime.notifyChanged(write.channelId);
    }
  }

  const now = () => (deps.now?.() ?? new Date()).toISOString();

  return {
    async send(send) {
      // Taken before the root is read: the write span joins the sender's trace.
      const trace = Telemetry.captureContext();
      const createdAt = now();
      const predicted = predictedMessage(send, createdAt);
      const rootId = send.message.thread_id;
      // A reply also moves its root's count; the queue applies both at once.
      const root = rootId && predicted ? await readMessage(rootId) : undefined;
      const entry = predicted && mapChannelTimelineEntry(predicted);
      return queuedWrite({
        operation: SEND_OPERATION,
        trace,
        channelId: send.channelId,
        messageId: send.id,
        uuid: send.id,
        predicted,
        unstored:
          predicted && entry && !rootId
            ? {
                key: channelMessageKey(send.id),
                sortKey: predicted.sortKey,
                entry,
              }
            : undefined,
        reply:
          predicted && rootId
            ? { rootId, message: mapChannelMessage(predicted) }
            : undefined,
        run: (client, options) =>
          executeOptimisticMutation(
            client as Client,
            SendChannelMessageDocument,
            {
              input: {
                channelId: send.channelId,
                id: send.id,
                content: send.message.content,
                threadId: rootId ?? null,
                mentions: (send.message.mentions ?? []).map(mentionInput),
                attachments: (send.message.attachments ?? []).map(
                  attachmentInput
                ),
                nonce: send.id,
              },
            },
            (predicted
              ? {
                  sendChannelMessage: {
                    __typename: WRITE_TYPENAME,
                    message: predicted,
                    root: root ? predictedRoot(root, predicted) : null,
                  },
                }
              : {}) as OptimisticResponse<SendChannelMessageMutation>,
            options
          ).toPromise(),
        written: (data) => data.sendChannelMessage,
      });
    },

    edit(edit) {
      const editedAt = now();
      return queuedWrite({
        operation: 'channel.write.edit',
        channelId: edit.channelId,
        messageId: edit.id,
        uuid: crypto.randomUUID(),
        run: (client, options) =>
          executeOptimisticMutation(
            client as Client,
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
                __typename: WRITE_TYPENAME,
                message: {
                  __typename: CHANNEL_MESSAGE_TYPENAME,
                  id: edit.id,
                  content: edit.content,
                  mentions: edit.mentions.map(mentionInput),
                  editedAt,
                  updatedAt: editedAt,
                },
              },
            } as OptimisticResponse<EditChannelMessageMutation>,
            options
          ).toPromise(),
        written: (data) => data.editChannelMessage,
      });
    },

    remove(deletion) {
      const deletedAt = now();
      return queuedWrite({
        operation: 'channel.write.delete',
        channelId: deletion.channelId,
        messageId: deletion.id,
        uuid: crypto.randomUUID(),
        run: (client, options) =>
          executeOptimisticMutation(
            client as Client,
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
                __typename: WRITE_TYPENAME,
                message: {
                  __typename: CHANNEL_MESSAGE_TYPENAME,
                  id: deletion.id,
                  deletedAt,
                  updatedAt: deletedAt,
                },
              },
            } as OptimisticResponse<DeleteChannelMessageMutation>,
            options
          ).toPromise(),
        written: (data) => data.deleteChannelMessage,
      });
    },

    react(reaction) {
      return queuedWrite({
        operation: 'channel.write.react',
        channelId: reaction.channelId,
        messageId: reaction.id,
        uuid: crypto.randomUUID(),
        run: (client, options) =>
          executeOptimisticMutation(
            client as Client,
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
                __typename: WRITE_TYPENAME,
                message: {
                  __typename: CHANNEL_MESSAGE_TYPENAME,
                  id: reaction.id,
                  ...(reaction.reactions && {
                    reactions: reaction.reactions.map(({ emoji, users }) => ({
                      emoji,
                      users: [...users],
                    })),
                  }),
                },
              },
            } as OptimisticResponse<ReactToChannelMessageMutation>,
            options
          ).toPromise(),
        written: (data) => data.reactToChannelMessage,
      });
    },

    pendingCount: (channelId) => pending[channelId]?.length ?? 0,
    unstoredRoots: (channelId) =>
      (pending[channelId] ?? [])
        .flatMap((write) => (write.unstored ? [write.unstored] : []))
        .reverse(),
    unstoredReplies: (channelId, rootId) =>
      (pending[channelId] ?? []).flatMap((write) =>
        write.reply?.rootId === rootId ? [write.reply.message] : []
      ),
    retire() {
      Deferred.doneUnsafe(
        retired,
        Effect.fail(refusal('CACHE_RETIRED', 'device cache was retired'))
      );
    },
  };
}
