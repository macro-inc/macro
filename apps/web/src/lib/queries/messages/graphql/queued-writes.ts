import { keepUnsentPostText } from '@channel/Input/utils/unsent-text';
import { toast } from '@core/component/Toast/Toast';
import { fireAndForget } from '@core/util/fireAndForget';
import type { CacheHost } from '@graphql-cache/host/types';
import type {
  MutationInspection,
  MutationSettlement,
} from '@graphql-cache/protocol';
import type {
  GraphqlChannelAttachmentInput,
  GraphqlChannelDeleteMessageInput,
  GraphqlChannelEditMessageInput,
  GraphqlChannelPostMessageInput,
  GraphqlChannelReactInput,
} from '@service-storage/graphql/generated/graphql';
import type {
  MessageAttachment,
  MessageParent,
} from '@service-storage/messages';
import { partialMatchKey, type QueryKey } from '@tanstack/solid-query';
import { queryClient } from '../../client';
import { messageKeys } from '../keys';
import { optimisticDeleteMessage, optimisticInsertMessage } from '../mutations';
import { optimisticAddReaction, optimisticRemoveReaction } from '../reactions';
import {
  getTargetMessage,
  patchTargetMessage,
  resolveMessageTarget,
} from '../reconcile';
import { getThreadRepliesQueryKeyPrefix } from '../thread-replies';
import { getMessageTimelineQueryKeyPrefix } from '../timeline';
import {
  catchUpTrackedChannel,
  isChannelTracked,
  reconcileFailedChannelWrite,
} from './channel-sync';
import { trackQueuedPosts } from './unsent-posts';

/**
 * A channel message write as the device cache's mutation queue holds it,
 * with what its optimistic change needs that the variables do not carry.
 */
export type QueuedChannelWrite =
  | {
      kind: 'post';
      input: GraphqlChannelPostMessageInput & { id: string };
      senderId: string;
    }
  | { kind: 'edit'; input: GraphqlChannelEditMessageInput }
  | {
      kind: 'delete';
      input: GraphqlChannelDeleteMessageInput;
      threadId?: string;
    }
  | {
      kind: 'react';
      input: GraphqlChannelReactInput;
      userId: string;
      threadId?: string;
    };

export const CHANNEL_WRITE_OPERATIONS = {
  post: 'PostChannelMessage',
  edit: 'EditChannelMessage',
  delete: 'DeleteChannelMessage',
  react: 'ReactToChannelMessage',
} as const satisfies Record<QueuedChannelWrite['kind'], string>;

const KIND_OF_OPERATION = Object.fromEntries(
  Object.entries(CHANNEL_WRITE_OPERATIONS).map(([kind, name]) => [name, kind])
) as Record<string, QueuedChannelWrite['kind'] | undefined>;

/** Where the queue keeps what a write's optimistic change needs. */
const METADATA_KEY = 'channelWrite';

type WriteMetadata = { senderId?: string; userId?: string; threadId?: string };

const SURFACE = 'channel-writes';

export function channelWriteMessageId(write: QueuedChannelWrite): string {
  return write.kind === 'post' ? write.input.id : String(write.input.messageId);
}

export function channelWriteParent(write: QueuedChannelWrite): MessageParent {
  return { type: 'channel', id: String(write.input.channelId) };
}

/** The queue's client metadata for a write: never sent to the server. */
export function channelWriteMetadata(
  write: QueuedChannelWrite
): Record<string, unknown> {
  const metadata: WriteMetadata =
    write.kind === 'post'
      ? { senderId: write.senderId }
      : write.kind === 'react'
        ? { userId: write.userId, threadId: write.threadId }
        : write.kind === 'delete'
          ? { threadId: write.threadId }
          : {};
  return { [METADATA_KEY]: metadata };
}

/** The failure toast a write's own hook shows, for a write restored after a reload. */
function failureText(write: QueuedChannelWrite): string {
  switch (write.kind) {
    case 'post':
      return 'Failed to send message';
    case 'edit':
      return 'Failed to update message';
    case 'delete':
      return 'Failed to delete message';
    case 'react':
      return write.input.add
        ? 'Failed to add reaction'
        : 'Failed to remove reaction';
  }
}

/**
 * A refused post restored after a reload has no hook to hand its text back
 * to; it goes to the channel's draft so what was typed is not lost.
 */
function keepUnsentText(write: QueuedChannelWrite): boolean {
  if (write.kind !== 'post') return false;
  return keepUnsentPostText({
    channelId: String(write.input.channelId),
    threadId:
      write.input.threadId == null ? null : String(write.input.threadId),
    content: write.input.content,
  });
}

type HeldWrite = {
  write: QueuedChannelWrite;
  /** A hook on this page waits on it and settles it itself. */
  live: boolean;
  /** The order this page started it in; restored writes come first. */
  order: number;
  /** When it was typed, so a restored change keeps its time. */
  enqueuedAtMs: number | undefined;
};

/** Queued channel writes by transaction id. */
const held = new Map<string, HeldWrite>();
/** Writes this page is sending that the queue may list before they are held. */
const liveUuids = new Map<string, number>();
const watchedHosts = new WeakMap<CacheHost, () => void>();
const restores = new WeakMap<CacheHost, Promise<void>>();
/** Settlements announced while a restore read the queue. */
/**
 * What settled while the queue was being read, per read in flight: the read's
 * snapshot can still list those writes. `live` ones belong to a hook.
 */
type SettledDuringRead = Map<
  string,
  { status: MutationSettlement['status']; live: boolean }
>;
const readsInFlight = new Set<SettledDuringRead>();
let reapplyCache: ReturnType<typeof queryClient.getQueryCache> | undefined;
let stopReapply: (() => void) | undefined;

function transactionOrder(a: string, b: string): number {
  const left = BigInt(a);
  const right = BigInt(b);
  return left < right ? -1 : left > right ? 1 : 0;
}

/** The channel's queued writes, oldest first, as the queue sends them. */
export function queuedChannelWrites(channelId: string): QueuedChannelWrite[] {
  return [...held.entries()]
    .filter(([, entry]) => String(entry.write.input.channelId) === channelId)
    .sort(([a], [b]) => transactionOrder(a, b))
    .map(([, entry]) => entry.write);
}

/** The rows of held posts say they are not sent once they have waited a while. */
function syncQueuedPosts() {
  const posts = new Map<string, number>();
  for (const entry of held.values()) {
    if (entry.write.kind !== 'post') continue;
    // A post restored without its queue time waited since before this page.
    posts.set(entry.write.input.id, entry.enqueuedAtMs ?? 0);
  }
  trackQueuedPosts(posts);
}

/** Whether the module holds a queued write for the channel. */
export function holdsQueuedChannelWrite(channelId: string): boolean {
  for (const entry of held.values()) {
    if (String(entry.write.input.channelId) === channelId) return true;
  }
  return false;
}

/**
 * A write this page is about to enqueue. Until the queue's answer names its
 * transaction, a restore that lists it leaves it to the page.
 */
export function expectLiveChannelWrite(uuid: string): () => void {
  liveUuids.set(uuid, (liveUuids.get(uuid) ?? 0) + 1);
  let done = false;
  return () => {
    if (done) return;
    done = true;
    const count = (liveUuids.get(uuid) ?? 1) - 1;
    if (count > 0) liveUuids.set(uuid, count);
    else liveUuids.delete(uuid);
  };
}

/**
 * Hold a write the queue answered as queued; the timeline keeps its change.
 * Two writes of one message can wait on the same transaction, an older one
 * replaced by a newer one while it was being sent; the newer is the one held.
 */
export function holdQueuedChannelWrite(
  host: CacheHost,
  transactionId: string,
  write: QueuedChannelWrite,
  options: { live: true; order: number }
) {
  watchHost(host);
  watchPageReplacements();
  const holding = held.get(transactionId);
  if (holding?.live && holding.order > options.order) return;
  held.set(transactionId, {
    write,
    live: options.live,
    order: options.order,
    enqueuedAtMs: Date.now(),
  });
  syncQueuedPosts();
}

/** The write settled; its change is no longer the timeline's to keep. */
export function releaseQueuedChannelWrite(transactionId: string) {
  if (held.delete(transactionId)) syncQueuedPosts();
}

/** A committed write's change arrives by its number, or by reading again. */
export function refreshAfterChannelWrite(parent: MessageParent) {
  if (catchUpTrackedChannel(parent)) return;
  invalidateChannel(parent);
}

/** A failed write's change is taken out by reading the channel again. */
function rereadAfterFailedWrite(parent: MessageParent) {
  if (isChannelTracked(parent)) reconcileFailedChannelWrite(parent);
  else invalidateChannel(parent);
}

function invalidateChannel(parent: MessageParent) {
  fireAndForget(
    queryClient.invalidateQueries({
      queryKey: getMessageTimelineQueryKeyPrefix(parent),
    }),
    SURFACE
  );
  fireAndForget(
    queryClient.invalidateQueries({
      queryKey: getThreadRepliesQueryKeyPrefix(parent),
    }),
    SURFACE
  );
}

function channelsOf(entries: Iterable<HeldWrite>): Set<string> {
  return new Set(
    [...entries].map((entry) => String(entry.write.input.channelId))
  );
}

/**
 * Settles the writes restored from the queue, which no hook on this page
 * waits on, and forgets every write when the cache's storage is replaced.
 */
function watchHost(host: CacheHost) {
  if (watchedHosts.has(host)) return;
  const stopSettled = host.onMutationSettled((settlement) =>
    onSettled(host, settlement)
  );
  const stopReset = host.onCacheGenerationChanged((change) => {
    if (change.storage === 'reset') onStorageReset(host);
  });
  watchedHosts.set(host, () => {
    stopSettled();
    stopReset();
  });
}

function onSettled(host: CacheHost, settlement: MutationSettlement) {
  const entry = held.get(settlement.transactionId);
  const live =
    entry?.live === true ||
    (settlement.mutationUuid !== undefined &&
      liveUuids.has(settlement.mutationUuid));
  for (const settled of readsInFlight) {
    settled.set(settlement.transactionId, { status: settlement.status, live });
  }
  if (!entry || entry.live) return;
  held.delete(settlement.transactionId);
  syncQueuedPosts();
  const parent = channelWriteParent(entry.write);
  if (settlement.status === 'committed') {
    refreshAfterChannelWrite(parent);
  } else if (settlement.status === 'permanently-failed') {
    if (!keepUnsentText(entry.write)) toast.failure(failureText(entry.write));
    rereadAfterFailedWrite(parent);
  } else if (!held.has(settlement.replacementTransactionId)) {
    // A newer write under the same key replaced it; read the queue for it.
    restores.delete(host);
    fireAndForget(restoreQueuedChannelWrites(host), SURFACE);
  }
}

/** The queue went with the storage: its writes will never be sent. */
function onStorageReset(host: CacheHost) {
  const lost = [...held.values()];
  held.clear();
  syncQueuedPosts();
  restores.delete(host);
  const failures = new Set(
    lost
      .filter((entry) => !entry.live && !keepUnsentText(entry.write))
      .map((entry) => failureText(entry.write))
  );
  for (const text of failures) toast.failure(text);
  for (const channelId of channelsOf(lost)) {
    rereadAfterFailedWrite({ type: 'channel', id: channelId });
  }
}

function metadataOf(inspection: MutationInspection): WriteMetadata {
  const value = inspection.clientMetadata?.[METADATA_KEY];
  return typeof value === 'object' && value !== null
    ? (value as WriteMetadata)
    : {};
}

/** The write a queue entry holds, when it is a channel message write. */
function writeFromInspection(
  inspection: MutationInspection
): QueuedChannelWrite | undefined {
  const kind = KIND_OF_OPERATION[inspection.operationName ?? ''];
  const input: unknown = inspection.variables.input;
  if (!kind || typeof input !== 'object' || input === null) return undefined;
  const metadata = metadataOf(inspection);
  // The variables are this client's own, written when the write was queued.
  switch (kind) {
    case 'post': {
      const post = input as GraphqlChannelPostMessageInput;
      if (typeof post.id !== 'string' || !metadata.senderId) return undefined;
      return {
        kind,
        input: { ...post, id: post.id },
        senderId: metadata.senderId,
      };
    }
    case 'edit':
      return { kind, input: input as GraphqlChannelEditMessageInput };
    case 'delete':
      return {
        kind,
        input: input as GraphqlChannelDeleteMessageInput,
        threadId: metadata.threadId,
      };
    case 'react':
      if (!metadata.userId) return undefined;
      return {
        kind,
        input: input as GraphqlChannelReactInput,
        userId: metadata.userId,
        threadId: metadata.threadId,
      };
  }
}

/**
 * Learn the channel writes the queue still holds from before this page
 * loaded, and put their changes back into the loaded timelines. Each cache
 * host's queue is read once; a write settled meanwhile is left out.
 */
export function restoreQueuedChannelWrites(host: CacheHost): Promise<void> {
  const running = restores.get(host);
  if (running) return running;
  const restore = readQueue(host);
  restores.set(host, restore);
  return restore;
}

async function readQueue(host: CacheHost) {
  if (!host.inspectMutations) return;
  watchHost(host);
  const settled: SettledDuringRead = new Map();
  readsInFlight.add(settled);
  let queue: MutationInspection[];
  try {
    queue = await host.inspectMutations();
  } catch (error) {
    restores.delete(host);
    throw error;
  } finally {
    readsInFlight.delete(settled);
  }
  const restored: HeldWrite[] = [];
  for (const inspection of queue) {
    if (
      inspection.superseded ||
      held.has(inspection.transactionId) ||
      liveUuids.has(inspection.uuid)
    )
      continue;
    const write = writeFromInspection(inspection);
    if (!write) continue;
    const outcome = settled.get(inspection.transactionId);
    if (outcome) {
      // Refused while the queue was being read: nothing held it yet.
      if (
        outcome.status === 'permanently-failed' &&
        !outcome.live &&
        !keepUnsentText(write)
      )
        toast.failure(failureText(write));
      continue;
    }
    const entry: HeldWrite = {
      write,
      live: false,
      order: 0,
      enqueuedAtMs: inspection.enqueuedAtMs,
    };
    held.set(inspection.transactionId, entry);
    restored.push(entry);
  }
  if (restored.length === 0) return;
  syncQueuedPosts();
  watchPageReplacements();
  for (const channelId of channelsOf(restored)) {
    reapplyQueuedChannelWrites({ type: 'channel', id: channelId });
  }
}

/**
 * Put the changes of the channel's queued writes back into its loaded
 * timeline and threads, in the order the queue sends them. A read of the
 * server's rows replaces them, and the server does not have them yet. Each
 * change is applied only where it is missing, so applying twice is a no-op.
 */
export function reapplyQueuedChannelWrites(parent: MessageParent) {
  if (parent.type !== 'channel') return;
  const entries = [...held.entries()]
    .filter(([, entry]) => String(entry.write.input.channelId) === parent.id)
    .sort(([a], [b]) => transactionOrder(a, b))
    .map(([, entry]) => entry);
  if (entries.length === 0) return;
  for (const [index, entry] of entries.entries()) {
    const messageId = channelWriteMessageId(entry.write);
    // A message the queue deletes later is not put back in the meantime.
    const deletedLater = entries
      .slice(index + 1)
      .some(
        (later) =>
          later.write.kind === 'delete' &&
          channelWriteMessageId(later.write) === messageId
      );
    if (deletedLater && entry.write.kind !== 'delete') continue;
    applyQueuedWrite(parent, entry);
  }
}

/** The time a UUIDv7 message id was minted, which is when it was typed. */
function mintedAt(messageId: string): number | undefined {
  const millis = Number.parseInt(
    messageId.replaceAll('-', '').slice(0, 12),
    16
  );
  return Number.isFinite(millis) ? millis : undefined;
}

function applyQueuedWrite(parent: MessageParent, entry: HeldWrite) {
  const { write } = entry;
  switch (write.kind) {
    case 'post':
      return applyQueuedPost(parent, write, entry.enqueuedAtMs);
    case 'edit':
      return applyQueuedEdit(parent, write, entry.enqueuedAtMs);
    case 'delete':
      return applyQueuedDelete(parent, write);
    case 'react':
      return applyQueuedReaction(parent, write);
  }
}

type WriteOf<Kind extends QueuedChannelWrite['kind']> = Extract<
  QueuedChannelWrite,
  { kind: Kind }
>;

function applyQueuedPost(
  parent: MessageParent,
  write: WriteOf<'post'>,
  enqueuedAtMs: number | undefined
) {
  const threadId =
    write.input.threadId == null ? undefined : String(write.input.threadId);
  const target = resolveMessageTarget({
    parent,
    messageId: write.input.id,
    threadId,
  });
  if (getTargetMessage(parent, target)) return;
  optimisticInsertMessage({
    parent,
    optimisticId: write.input.id,
    senderId: write.senderId,
    content: write.input.content,
    mentions: write.input.mentions?.map((mention) => ({
      entity_id: mention.entityId,
      entity_type: mention.entityType,
    })),
    attachments: write.input.attachments?.map((attachment) => ({
      entity_id: attachment.entityId,
      entity_type: attachment.entityType,
      width: attachment.width ?? undefined,
      height: attachment.height ?? undefined,
    })),
    thread_id: threadId,
    restoredAt: new Date(
      mintedAt(write.input.id) ?? enqueuedAtMs ?? Date.now()
    ).toISOString(),
  });
}

function applyQueuedEdit(
  parent: MessageParent,
  write: WriteOf<'edit'>,
  enqueuedAtMs: number | undefined
) {
  const at = new Date(enqueuedAtMs ?? Date.now()).toISOString();
  const target = resolveMessageTarget({
    parent,
    messageId: String(write.input.messageId),
  });
  const message = getTargetMessage(parent, target);
  if (!message) return;
  const content = write.input.content ?? message.content;
  const attachments = editedAttachments(message.attachments, write.input, at);
  if (
    content === message.content &&
    sameAttachments(attachments, message.attachments)
  )
    return;
  patchTargetMessage(parent, target, {
    content,
    attachments,
    edited_at: at,
    updated_at: at,
  });
}

function applyQueuedDelete(parent: MessageParent, write: WriteOf<'delete'>) {
  const target = resolveMessageTarget({
    parent,
    messageId: String(write.input.messageId),
    threadId: write.threadId,
  });
  const message = getTargetMessage(parent, target);
  if (!message || (target.kind === 'top_level' && message.deleted_at)) return;
  optimisticDeleteMessage({
    parent,
    message_id: String(write.input.messageId),
    threadId: write.threadId,
  });
}

function applyQueuedReaction(parent: MessageParent, write: WriteOf<'react'>) {
  const target = resolveMessageTarget({
    parent,
    messageId: String(write.input.messageId),
    threadId: write.threadId,
  });
  const message = getTargetMessage(parent, target);
  if (!message) return;
  const react = write.input.add
    ? optimisticAddReaction
    : optimisticRemoveReaction;
  react({
    parent,
    message_id: String(write.input.messageId),
    emoji: write.input.emoji,
    userId: write.userId,
    currentReactions: message.reactions,
    threadId: target.kind === 'thread_reply' ? target.threadId : undefined,
  });
}

/** A message's attachments once a queued edit applies, keeping rows it already shows. */
function editedAttachments(
  current: MessageAttachment[],
  input: GraphqlChannelEditMessageInput,
  at: string
): MessageAttachment[] {
  const change = input.attachments;
  if (!change) return current;
  const added = (entities: readonly GraphqlChannelAttachmentInput[]) =>
    entities.map(
      (entity) =>
        current.find(
          (attachment) =>
            attachment.entity_id === entity.entityId &&
            attachment.entity_type === entity.entityType
        ) ?? {
          id: crypto.randomUUID(),
          entity_id: entity.entityId,
          entity_type: entity.entityType,
          width: entity.width ?? undefined,
          height: entity.height ?? undefined,
          created_at: at,
        }
    );
  if (change.replace) return added(change.replace);
  const delta = change.delta;
  if (!delta) return current;
  const removed = new Set(delta.remove.map(String));
  const kept = current.filter((attachment) => !removed.has(attachment.id));
  const missing = delta.add.filter(
    (entity) =>
      !kept.some(
        (attachment) =>
          attachment.entity_id === entity.entityId &&
          attachment.entity_type === entity.entityType
      )
  );
  return [...kept, ...added(missing)];
}

function sameAttachments(
  left: readonly MessageAttachment[],
  right: readonly MessageAttachment[]
): boolean {
  return (
    left.length === right.length &&
    left.every((attachment, index) => attachment.id === right[index]?.id)
  );
}

/** The channel a timeline or thread query belongs to. */
function channelOfQuery(queryKey: QueryKey): MessageParent | undefined {
  const prefix = [
    messageKeys.messages._def,
    messageKeys.threadReplies._def,
  ].find((key) => partialMatchKey(queryKey, key));
  if (!prefix) return undefined;
  const parent: unknown = queryKey[prefix.length];
  if (typeof parent !== 'object' || parent === null) return undefined;
  const { type, id } = parent as Partial<MessageParent>;
  return type === 'channel' && typeof id === 'string'
    ? { type, id }
    : undefined;
}

/**
 * A page read from the server replaces the rows queued changes were applied
 * to; apply them again as it lands. Changes written by hand are not reads.
 */
function watchPageReplacements() {
  const cache = queryClient.getQueryCache();
  if (reapplyCache === cache) return;
  stopReapply?.();
  reapplyCache = cache;
  stopReapply = cache.subscribe((event) => {
    if (
      event.type !== 'updated' ||
      event.action.type !== 'success' ||
      event.action.manual
    )
      return;
    const parent = channelOfQuery(event.query.queryKey);
    if (parent && holdsQueuedChannelWrite(parent.id))
      reapplyQueuedChannelWrites(parent);
  });
}

/**
 * Whether the device cache's queue still holds a write to the channel, from
 * this page, another tab, or before a reload. A page written to the cache
 * meanwhile could be overwritten by the write's older response when it
 * commits, under a number that no catch-up corrects.
 */
export async function queueHoldsChannelWrite(
  host: CacheHost,
  channelId: string
): Promise<boolean> {
  if (!host.inspectMutations) return false;
  const queue = await host.inspectMutations();
  return queue.some((inspection) => {
    if (!KIND_OF_OPERATION[inspection.operationName ?? '']) return false;
    const input: unknown = inspection.variables.input;
    return (
      typeof input === 'object' &&
      input !== null &&
      String(Reflect.get(input, 'channelId')) === channelId
    );
  });
}

/** Forget every held write and listener; tests start from a fresh page. */
export function resetQueuedChannelWrites() {
  held.clear();
  syncQueuedPosts();
  liveUuids.clear();
  stopReapply?.();
  stopReapply = undefined;
  reapplyCache = undefined;
  readsInFlight.clear();
}
