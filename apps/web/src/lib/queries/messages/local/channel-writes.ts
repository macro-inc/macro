import { anyAbortSignal } from '@core/util/abort-signal';
import { fireAndForget } from '@core/util/fireAndForget';
import { ThrownResultError, thrownResultErrorHasCode } from '@core/util/result';
import {
  executeOptimisticMutation,
  type OptimisticResponse,
  optimisticMutationDispositionOf,
} from '@graphql-cache/exchange/optimistic';
import type { CacheGenerationChange } from '@graphql-cache/host/types';
import type { CacheHost } from '@graphql-cache/index';
import {
  isAdmittedEnqueueUncertainError,
  type MutationSettlement,
} from '@graphql-cache/protocol';
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
import { createStore, produce, unwrap } from 'solid-js/store';
import {
  CHANNEL_MESSAGE_TYPENAME,
  channelMessageKey,
  mapChannelMessage,
  mapChannelTimelineEntry,
  timestampMicros,
  unplacedSortKey,
} from './channel-map';
import { queryChannelNetwork } from './channel-network';
import type { ChannelPageEntry } from './channel-pages';
import { readStoredMessage, readTimelineRecords } from './channel-pages';
import type { ChannelSyncRuntime } from './channel-sync-runtime';
import { announceWritten } from './channel-tab-writes';

const WRITE_TYPENAME = 'GraphqlChannelMessageWrite';
const SEND_OPERATION = 'channel.write.send';
/** The queue's code for a write it stopped retrying. */
const RETRY_EXHAUSTED = 'MUTATION_RETRY_EXHAUSTED';
/** Waits before asking the server again whether it has a send. */
const SERVER_LOOKUP_RETRIES_MS = [500, 1_000];
/**
 * How long one such question waits for the server: an unanswered request is
 * cancelled, so the next question sends a fresh one rather than joining it.
 */
const SERVER_LOOKUP_BUDGET_MS = 10_000;
/**
 * How long a server copy of a send then waits to be stored on the device
 * before it answers anyway; the server's answer is what decides the send.
 */
const SERVER_COPY_STORE_BUDGET_MS = 5_000;

/**
 * Reads one message from the server; null when the server does not have it.
 * `signal` cancels the request. `storedLate` runs once a copy that answered
 * before the device stored it is stored after all.
 */
export type FetchChannelMessage = (
  channelId: string,
  messageId: string,
  signal: AbortSignal,
  storedLate?: () => void
) => Promise<ChannelMessageFieldsFragment | null>;

/** Whether the device stored a read; a failure is reported, not thrown. */
async function storeOutcome(cached: Promise<void>): Promise<boolean> {
  try {
    await cached;
    return true;
  } catch (error) {
    Telemetry.error(error, { surface: 'channel-writes' });
    return false;
  }
}

async function whenStoredLate(
  storing: Promise<boolean>,
  storedLate: (() => void) | undefined
): Promise<void> {
  if (await storing) storedLate?.();
}

type Settled<T> = { ok: true; value: T } | { ok: false; error: unknown };

async function settle<T>(promise: Promise<T>): Promise<Settled<T>> {
  try {
    return { ok: true, value: await promise };
  } catch (error) {
    return { ok: false, error };
  }
}

const fetchServerMessage: FetchChannelMessage = async (
  channelId,
  messageId,
  signal,
  storedLate
) => {
  // Cancelled when unanswered within the budget: urql would hand the next
  // question the same request rather than send a new one.
  const request = new AbortController();
  const answer = await Effect.runPromise(
    Effect.timeoutOrElse(
      Effect.promise(() =>
        settle(
          queryChannelNetwork(
            ChannelMessageDocument,
            { channelId, messageId },
            anyAbortSignal([signal, request.signal])
          )
        )
      ),
      {
        duration: SERVER_LOOKUP_BUDGET_MS,
        orElse: () =>
          Effect.sync(() => {
            request.abort();
            return undefined;
          }),
      }
    )
  );
  if (!answer) throw new Error('the server did not answer in time');
  if (!answer.ok) throw answer.error;
  const { data, cached } = answer.value;
  // The views reread when the write ends, so the device should hold it then;
  // a copy that could not be stored, or is still storing after
  // `SERVER_COPY_STORE_BUDGET_MS`, is still the answer; one stored after that
  // tells the views again, since their reread came before it.
  const storing = storeOutcome(cached);
  const inTime = await Effect.runPromise(
    Effect.timeoutOrElse(
      Effect.promise(() => storing),
      {
        duration: SERVER_COPY_STORE_BUDGET_MS,
        orElse: () => Effect.succeed(undefined),
      }
    )
  );
  // Only a copy found: an empty answer stores nothing the views would show.
  if (inTime === undefined && data.user.channelMessage)
    fireAndForget(whenStoredLate(storing, storedLate), 'channel-writes');
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
  | 'paused'
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
  /** The person reacting, to tell whether the device shows the change. */
  userId: string;
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
  /** The row a send predicts, its replies not counted. */
  predicted?: ChannelMessageFieldsFragment;
  /** A root this device sent that the device does not show yet. */
  unstored?: ChannelPageEntry;
  /** A reply this device sent, shown in its thread until the device has it. */
  reply?: UnstoredReply;
  /** The message this write deletes, which no row kept here shows again. */
  deletes?: string;
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
  /** The host's database is back after an outage: hands over the writes it kept. */
  resumed(): void;
}

/** The messages that writes waiting here delete. A send's uuid is its message id. */
const deletedIds = (writes: readonly PendingWrite[]): ReadonlySet<string> =>
  new Set(writes.flatMap((write) => (write.deletes ? [write.deletes] : [])));

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

const unknownDelivery = () =>
  refusal(
    'DELIVERY_UNKNOWN',
    'the server could not say whether it has the send'
  );

function refusalOf(error: CombinedError): ThrownResultError {
  const code = error.graphQLErrors[0]?.extensions.code;
  return refusal(
    typeof code === 'string' ? code : error.networkError && 'NETWORK_ERROR',
    error.message
  );
}

/** First wait before asking an unanswering queue again, doubled up to the cap. */
const QUEUE_RECHECK_MS = 1_000;
const QUEUE_RECHECK_MAX_MS = 30_000;
/**
 * How long a delete waits for the device's copy of a reply's root before it
 * goes without the root: the server's answer brings the root then.
 */
const ROOT_READ_BUDGET_MS = 500;

/**
 * Waits for the queue to settle one write, or the transaction that replaced
 * it. The write is its transaction and its mutation id: transaction ids
 * restart when the queue is rebuilt, so a settlement or a queued entry for
 * another mutation under the same transaction id is not this write's.
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
 * caller reads from the device and then the server. A queue that cannot
 * answer is asked again, backing off, since its settlement may already have
 * gone by; after a reset it loses the write instead (`CACHE_RESET`).
 */
function watchSettlements(
  host: ChannelWriteHost,
  retired: Lost,
  mutationUuid: string
) {
  const settlements = new Map<string, Deferred.Deferred<MutationSettlement>>();
  const reset: Lost = Deferred.makeUnsafe();
  const missed = Deferred.makeUnsafe<'missed'>();
  let waiting: string | undefined;
  // A generation change heard before the wait had a transaction to check.
  let unchecked: CacheGenerationChange['storage'] | undefined;
  let recheck: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  const lost = () =>
    Deferred.doneUnsafe(
      reset,
      Effect.fail(refusal('CACHE_RESET', 'device cache was reset'))
    );
  /**
   * After the engine comes back, with its storage kept or (as a host that
   * was suspended conservatively reports) reset, asks the queue: a write it
   * still holds keeps waiting, and one that left it unheard is `missed`.
   * Without an answer, a reset loses the write and a kept store is asked
   * again later.
   */
  const checkQueued = async (
    storage: CacheGenerationChange['storage'],
    retryMs = QUEUE_RECHECK_MS
  ) => {
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
      if (storage === 'reset') {
        lost();
        return;
      }
      Telemetry.error(error, { surface: 'channel-writes' });
      // A host that cannot list its queue never will: wait for the settlement.
      if (!host.inspectMutations || stopped || waiting !== transactionId)
        return;
      clearTimeout(recheck);
      recheck = setTimeout(
        () =>
          fireAndForget(
            checkQueued(storage, Math.min(retryMs * 2, QUEUE_RECHECK_MAX_MS)),
            'channel-writes'
          ),
        retryMs
      );
      return;
    }
    if (waiting !== transactionId) return;
    if (
      queue.some(
        (entry) =>
          entry.transactionId === transactionId && entry.uuid === mutationUuid
      )
    )
      return;
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
    if (
      settlement.mutationUuid !== undefined &&
      settlement.mutationUuid !== mutationUuid
    )
      return;
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
      stopped = true;
      clearTimeout(recheck);
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

/** The server previews a thread with its oldest live replies, this many. */
const THREAD_PREVIEW_LIMIT = 3;

/** The root as it will read once the reply is on it. */
export function predictedRoot(
  root: ChannelMessageFieldsFragment,
  reply: ChannelMessageFieldsFragment
): ChannelMessageFieldsFragment {
  if (!root.thread) return root;
  // The preview is the oldest replies: the new one joins it only while the
  // preview still holds every reply.
  const { preview, replyCount } = root.thread;
  const joinsPreview =
    preview.length === replyCount && replyCount < THREAD_PREVIEW_LIMIT;
  return {
    ...root,
    thread: {
      ...root.thread,
      preview: joinsPreview ? [...preview, reply] : preview,
      replyCount: root.thread.replyCount + 1,
      latestReplyAt: reply.createdAt,
      updatedAt: reply.createdAt,
    },
  };
}

/** The root as it will read once its live `reply` is deleted. */
export function predictedRootWithout(
  root: ChannelMessageFieldsFragment,
  reply: Pick<ChannelMessageFieldsFragment, 'id' | 'createdAt'>
): ChannelMessageFieldsFragment {
  if (!root.thread) return root;
  const preview = root.thread.preview.filter(({ id }) => id !== reply.id);
  const replyCount = Math.max(0, root.thread.replyCount - 1);
  // The server reads the latest live reply. It is known while the preview
  // holds every reply, or when the deleted one was not the latest; otherwise
  // it comes with the server's root, as does the reply after the preview in
  // a longer thread. A queued send sits last in the preview whatever its
  // time, so the latest is the newest time there, not the last reply's.
  let { latestReplyAt } = root.thread;
  if (replyCount === 0) latestReplyAt = null;
  else if (preview.length === replyCount)
    latestReplyAt = newestCreatedAt(preview) ?? latestReplyAt;
  return {
    ...root,
    thread: { ...root.thread, preview, replyCount, latestReplyAt },
  };
}

/** The newest creation time among `messages`, to the server's microsecond. */
function newestCreatedAt(
  messages: readonly Pick<ChannelMessageFieldsFragment, 'createdAt'>[]
): string | undefined {
  let newest: { at: string; micros: bigint } | undefined;
  for (const { createdAt } of messages) {
    const micros = timestampMicros(createdAt);
    if (micros === undefined) continue;
    if (newest === undefined || micros > newest.micros)
      newest = { at: createdAt, micros };
  }
  return newest?.at;
}

/** A root being sent as it reads with the replies to it being sent too. */
function pendingRoot(
  writes: readonly PendingWrite[],
  rootId: string
): ChannelMessageFieldsFragment | undefined {
  const root = writes.find((write) => write.uuid === rootId)?.predicted;
  if (!root) return undefined;
  const deleted = deletedIds(writes);
  return writes.reduce(
    (counted, { predicted: reply }) =>
      reply?.threadId === rootId && !deleted.has(reply.id)
        ? predictedRoot(counted, reply)
        : counted,
    root
  );
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
  /**
   * Whether the device's copy shows this write, for one that left the queue
   * unheard: another tab may have rolled it back. A send is checked against
   * the server instead.
   */
  applied?: (message: ChannelMessageFieldsFragment) => boolean;
  unstored?: ChannelPageEntry;
  reply?: UnstoredReply;
  /** The message this write deletes. */
  deletes?: string;
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
  /** While the host's database is away: done once it serves again. */
  let served: Deferred.Deferred<void> | undefined;

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

  /**
   * The root of a live reply on the device as it will read once the reply is
   * deleted; undefined for anything else, or when the device takes longer
   * than a delete waits for it.
   */
  function rootWithoutReply(
    deletion: Pick<ChannelDelete, 'channelId' | 'id'>
  ): Promise<ChannelMessageFieldsFragment | undefined> {
    // Interrupted once the budget runs out: a reply read that answers later
    // asks nothing more of the device.
    const read = Effect.promise(async (signal) => {
      const reply = await readStoredMessage(
        deps.host,
        deletion.channelId,
        deletion.id
      );
      if (signal.aborted) return undefined;
      if (!reply?.threadId || reply.deletedAt !== null) return undefined;
      const root = await readMessage(reply.threadId);
      return root && predictedRootWithout(root, reply);
    });
    return Effect.runPromise(
      Effect.timeoutOrElse(read, {
        duration: ROOT_READ_BUDGET_MS,
        orElse: () => Effect.succeed(undefined),
      })
    );
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
    write: Pick<Write<unknown, AnyVariables>, 'channelId' | 'messageId'>,
    signal: AbortSignal
  ): Promise<Message | null | undefined> {
    try {
      const message = await (deps.fetchMessage ?? fetchServerMessage)(
        write.channelId,
        write.messageId,
        signal,
        () => {
          deps.runtime.notifyChanged(write.channelId);
          announceWritten(write.channelId);
        }
      );
      return message && mapChannelMessage(message);
    } catch (error) {
      Telemetry.error(error, { surface: 'channel-writes' });
      return undefined;
    }
  }

  /**
   * A write that left the queue while this page heard nothing, delivered or
   * rolled back by another tab. A send is delivered when the device or the
   * server holds it, and unknown otherwise: a request the server has not
   * answered can still commit, and only the same id makes sending it again
   * safe. Another write is delivered when the device's copy
   * shows it (`applied`), which a rollback undoes.
   */
  async function missedOutcome(
    write: Pick<
      Write<unknown, AnyVariables>,
      'channelId' | 'messageId' | 'operation' | 'applied'
    >,
    trace: TraceContext
  ): Promise<Message> {
    const message = await readMessage(write.messageId);
    if (message && (write.applied?.(message) ?? true))
      return mapChannelMessage(message);
    if (message) {
      throw refusal('NOT_APPLIED', 'the write was rolled back elsewhere');
    }
    if (write.operation !== SEND_OPERATION) {
      throw refusal('NOT_FOUND', 'the message is not on the device');
    }
    const delivered = await askServer(write, trace);
    if (delivered) return delivered;
    throw unknownDelivery();
  }

  /**
   * A failed send restores its draft, and sending that again would post a
   * second copy of one that arrived: ask the server more than once, since a
   * request still in flight can commit after the server said it had none, and
   * the device again between questions, since a frame or another tab may store
   * the send meanwhile.
   */
  async function askServer(
    write: Pick<Write<unknown, AnyVariables>, 'channelId' | 'messageId'>,
    trace: TraceContext
  ): Promise<Message | undefined> {
    // Every question, after a wait too, joins the recovery's trace.
    const ask = () => trace.run(() => boundedServerCopy(write));
    const onDevice = async () => {
      const stored = await trace.run(() => readMessage(write.messageId));
      return stored && mapChannelMessage(stored);
    };
    let delivered = await ask();
    for (const waitMs of SERVER_LOOKUP_RETRIES_MS) {
      if (delivered) return delivered;
      const stored = await onDevice();
      if (stored) return stored;
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      delivered = await ask();
    }
    return delivered || (await onDevice());
  }

  /**
   * `serverCopy`, answered within `SERVER_LOOKUP_BUDGET_MS` and
   * `SERVER_COPY_STORE_BUDGET_MS`: a lookup that never answers leaves the
   * send unknown instead of pending forever, and its request is cancelled.
   */
  function boundedServerCopy(
    write: Pick<Write<unknown, AnyVariables>, 'channelId' | 'messageId'>
  ): Promise<Message | null | undefined> {
    const request = new AbortController();
    // Started here, in the caller's trace.
    const copy = serverCopy(write, request.signal);
    return Effect.runPromise(
      Effect.timeoutOrElse(
        Effect.promise(() => copy),
        {
          duration: SERVER_LOOKUP_BUDGET_MS + SERVER_COPY_STORE_BUDGET_MS,
          orElse: () =>
            Effect.sync(() => {
              request.abort();
              return undefined;
            }),
        }
      )
    );
  }

  /** Reads a waiting write's outcome from the device and the server. */
  function recovered<T>(
    write: Pick<
      Write<unknown, AnyVariables>,
      'operation' | 'channelId' | 'messageId'
    >,
    reason: 'missed' | 'retry_exhausted' | 'enqueue_uncertain' | 'answer_lost',
    read: (trace: TraceContext) => Promise<T>
  ): Promise<T> {
    return Telemetry.span('channel.write.recover', async (span) => {
      // Taken before any await: the reads that follow one join this span.
      const trace = Telemetry.captureContext();
      span.setAttr('channel.id', write.channelId);
      span.setAttr('message.id', write.messageId);
      span.setAttr('write.operation', write.operation);
      span.setAttr('write.recovery', reason);
      const outcome = await read(trace);
      span.setAttr('write.recovered', outcome !== undefined);
      return outcome;
    });
  }

  /**
   * A send the queue gave up on after retrying it may still have reached the
   * server, or reach it later: a restored draft would go out again under a
   * new id. The device's copy (a frame may have stored the server's row),
   * else the server's, is the send's answer; without either the send is
   * unknown, so the composer sends it again under its own id.
   */
  async function deliveredAfterAll(
    write: Pick<
      Write<unknown, AnyVariables>,
      'channelId' | 'messageId' | 'operation'
    >,
    error: unknown,
    trace: TraceContext
  ): Promise<Message | undefined> {
    if (write.operation !== SEND_OPERATION) return undefined;
    if (!thrownResultErrorHasCode(error, RETRY_EXHAUSTED)) return undefined;
    // The queue rolled its optimistic record back before it settled: a copy
    // here is the server's.
    const stored = await readMessage(write.messageId);
    if (stored) return mapChannelMessage(stored);
    const delivered = await askServer(write, trace);
    if (delivered) return delivered;
    throw unknownDelivery();
  }

  /** The transaction the queue holds a write under; undefined when it does not. */
  async function queuedAs(uuid: string): Promise<string | undefined> {
    if (!deps.host.inspectMutations) throw new Error('queue cannot be listed');
    const queue = await deps.host.inspectMutations();
    return queue.find((entry) => entry.uuid === uuid)?.transactionId;
  }

  /**
   * The write's answer when the queue, the server or the network lost it on
   * the way; undefined for an answer that says what became of the write.
   */
  async function lostAnswer(
    write: Pick<
      Write<unknown, AnyVariables>,
      'channelId' | 'messageId' | 'operation' | 'applied' | 'uuid'
    >,
    error: CombinedError,
    trace: TraceContext,
    settled: (transactionId: string) => Promise<Message>
  ): Promise<Message | undefined> {
    if (isAdmittedEnqueueUncertainError(error.networkError)) {
      let transactionId: string | undefined;
      try {
        transactionId = await trace.run(() =>
          recovered(write, 'enqueue_uncertain', () => queuedAs(write.uuid))
        );
      } catch (failure) {
        Telemetry.error(failure, { surface: 'channel-writes' });
        // A copy on the device can be the optimistic record of a queue that
        // holds the write, so it says nothing about the server.
        if (write.operation === SEND_OPERATION) throw unknownDelivery();
        return undefined;
      }
      if (transactionId) return settled(transactionId);
      return trace.run(() =>
        recovered(write, 'missed', (recovery) => missedOutcome(write, recovery))
      );
    }
    // Sent straight out, past the queue: the server may have it.
    if (!error.networkError || write.operation !== SEND_OPERATION)
      return undefined;
    const delivered = await trace.run(() =>
      recovered(write, 'answer_lost', (recovery) => askServer(write, recovery))
    );
    if (delivered) return delivered;
    throw unknownDelivery();
  }

  /**
   * Waits out an outage of the host's database: straight out, a write would
   * pass the queue, and one made later could reach the server first. A write
   * made as the database comes back waits with the ones already waiting.
   */
  async function untilServed(
    write: Pick<
      Write<unknown, AnyVariables>,
      'operation' | 'channelId' | 'messageId'
    >
  ): Promise<void> {
    while (deps.host.paused || served) {
      served ??= Deferred.makeUnsafe<void>();
      const waiting = Deferred.await(served);
      await Telemetry.span('channel.write.await_cache', async (span) => {
        span.setAttr('channel.id', write.channelId);
        span.setAttr('message.id', write.messageId);
        span.setAttr('write.operation', write.operation);
        await Effect.runPromise(
          Effect.raceFirst(waiting, Deferred.await(retired))
        );
      });
    }
  }

  async function queuedWrite<TData, TVariables extends AnyVariables>(
    write: Write<TData, TVariables>
  ): Promise<Message> {
    // Taken before any await: recovery after a long wait joins the write's trace.
    const trace = write.trace ?? Telemetry.captureContext();
    const settlements = watchSettlements(deps.host, retired, write.uuid);
    addPending(write.channelId, {
      uuid: write.uuid,
      predicted: write.predicted,
      unstored: write.unstored,
      reply: write.reply,
      deletes: write.deletes,
    });
    deps.runtime.notifyChanged(write.channelId);
    // The optimistic record is on the device: windows read it from here, in
    // every tab.
    const onEnqueued = () => {
      deps.runtime.notifyChanged(write.channelId);
      announceWritten(write.channelId);
    };
    try {
      // The span covers the hand-off and a direct answer; a queued write can
      // wait for hours, which is not this operation's duration.
      const traced = <T>(operation: () => T): T => trace.run(operation);
      await traced(() => untilServed(write));
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
      const settled = async (transactionId: string): Promise<Message> => {
        let outcome: 'committed' | 'missed';
        try {
          outcome = await settlements.committed(transactionId);
        } catch (error) {
          const delivered = await traced(() =>
            recovered(write, 'retry_exhausted', (recovery) =>
              deliveredAfterAll(write, error, recovery)
            )
          );
          if (delivered) return delivered;
          throw error;
        }
        if (outcome === 'missed')
          return await traced(() =>
            recovered(write, 'missed', (recovery) =>
              missedOutcome(write, recovery)
            )
          );
        return stored(write);
      };
      const disposition = optimisticMutationDispositionOf(result);
      if (disposition?.kind === 'queued')
        return await settled(disposition.transactionId);
      const { error } = result;
      if (error) {
        const answer = disposition
          ? undefined
          : await lostAnswer(write, error, trace, settled);
        if (answer) return answer;
        throw refusalOf(error);
      }
      if (!result.data) throw refusal(undefined, 'empty response');
      return mapChannelMessage(write.written(result.data).message);
    } finally {
      settlements.stop();
      removePending(write.channelId, write.uuid);
      // Committed or rolled back, the device's copy changed.
      deps.runtime.notifyChanged(write.channelId);
      announceWritten(write.channelId);
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
      // The device has nothing yet of a root whose own send is not stored.
      const root =
        rootId && predicted
          ? ((await readMessage(rootId)) ??
            pendingRoot(unwrap(pending)[send.channelId] ?? [], rootId))
          : undefined;
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
        // The text alone cannot tell an attachment-only edit was undone.
        applied: (message) =>
          message.content === edit.content &&
          edit.removeAttachmentIds.every(
            (id) =>
              !message.attachments.some(
                (attachment) => attachment.attachmentId === id
              )
          ) &&
          edit.addAttachments.every((added) =>
            message.attachments.some(
              (attachment) =>
                attachment.entityType === added.entity_type &&
                attachment.entityId === added.entity_id
            )
          ),
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
      // A live reply also leaves its root's preview and count; the queue
      // applies both at once. The device answers this read in milliseconds,
      // and a stored message stays on screen until the delete is queued, so
      // the delete waits for it only briefly.
      const reading = rootWithoutReply(deletion);
      return queuedWrite({
        operation: 'channel.write.delete',
        channelId: deletion.channelId,
        messageId: deletion.id,
        uuid: crypto.randomUUID(),
        deletes: deletion.id,
        applied: (message) => message.deletedAt !== null,
        run: async (client, options) => {
          // Taken before the read: the mutation joins the write's span.
          const span = Telemetry.captureContext();
          const root = await reading;
          return span.run(() =>
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
                  ...(root && { root }),
                },
              } as OptimisticResponse<DeleteChannelMessageMutation>,
              options
            ).toPromise()
          );
        },
        written: (data) => data.deleteChannelMessage,
      });
    },

    react(reaction) {
      return queuedWrite({
        operation: 'channel.write.react',
        channelId: reaction.channelId,
        messageId: reaction.id,
        uuid: crypto.randomUUID(),
        applied: (message) =>
          message.reactions.some(
            (entry) =>
              entry.emoji === reaction.emoji &&
              entry.users.includes(reaction.userId)
          ) === reaction.add,
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
    // A message deleted while its send waits stays hidden: the device hides
    // a deleted root and a deleted reply, and this row would bring it back.
    unstoredRoots: (channelId) => {
      const writes = pending[channelId] ?? [];
      const deleted = deletedIds(writes);
      return writes
        .flatMap((write) => {
          if (!write.unstored || deleted.has(write.uuid)) return [];
          if (!writes.some(({ reply }) => reply?.rootId === write.uuid))
            return [write.unstored];
          const root = pendingRoot(writes, write.uuid);
          const entry = root && mapChannelTimelineEntry(root);
          return [entry ? { ...write.unstored, entry } : write.unstored];
        })
        .reverse();
    },
    unstoredReplies: (channelId, rootId) => {
      const writes = pending[channelId] ?? [];
      const deleted = deletedIds(writes);
      return writes.flatMap((write) =>
        write.reply?.rootId === rootId && !deleted.has(write.reply.message.id)
          ? [write.reply.message]
          : []
      );
    },
    resumed() {
      const waited = served;
      served = undefined;
      if (waited) Deferred.doneUnsafe(waited, Effect.void);
    },
    retire() {
      Deferred.doneUnsafe(
        retired,
        Effect.fail(refusal('CACHE_RETIRED', 'device cache was retired'))
      );
    },
  };
}
