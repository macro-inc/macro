import type { MessageEvent } from '@service-storage/generated/schemas/messageEvent';
import type {
  Message,
  MessageListItem,
  MessageParent,
  MessageThread,
} from '@service-storage/messages';
import { entityMessagesClient } from '@service-storage/messages';
import { queryClient } from '../client';
import { consumeNonce } from '../nonce';
import { MessageNonceKeys, messageKeys } from './keys';
import { normalizeMessageSender } from './message-sender';
import {
  getTargetMessage,
  insertMessageIntoTargetCaches,
  patchTargetMessage,
  removeMessageFromTargetCaches,
  resolveMessageTarget,
  softInvalidateTargetCaches,
  topLevelMessageHasReplies,
} from './reconcile';
import { getThreadRepliesQueryKey } from './thread-replies';
import {
  getMessageTimelineQueryKey,
  getMessageTimelineQueryKeyPrefix,
  type MessageTimelineData,
  setMessageTimelineData,
} from './timeline';
import { handleCommsTyping } from './typing';

const awaitingInitialActivityRead = new WeakSet<object>();

/** A committed activity must also refresh windows whose initial response is in flight. */
export function handleTimelineActivityUpdated(parent: MessageParent) {
  const queries = queryClient.getQueryCache().findAll({
    queryKey: getMessageTimelineQueryKeyPrefix(parent),
  });
  for (const query of queries) {
    const refetch = () =>
      queryClient.invalidateQueries({ queryKey: query.queryKey, exact: true });
    const inFlight = query.promise;
    if (query.state.data || !inFlight) {
      void refetch();
      continue;
    }
    if (awaitingInitialActivityRead.has(query)) continue;
    awaitingInitialActivityRead.add(query);
    async function afterInitialRead() {
      try {
        await inFlight;
      } catch {
        // The query owns its error state; the committed event still needs a fresh read.
      } finally {
        awaitingInitialActivityRead.delete(query);
      }
      await refetch();
    }
    void afterInitialRead();
  }
}

type ThreadStateListener = (
  parent: MessageParent,
  state: MessageThread['state']
) => void;
const threadStateListeners = new Set<ThreadStateListener>();

/** Notify annotation editors of committed lifecycle changes without inferring deletion from paged reads. */
export function onThreadStateUpdated(listener: ThreadStateListener) {
  threadStateListeners.add(listener);
  return () => threadStateListeners.delete(listener);
}

/** Preserve the event kind: only posts insert messages, and only deletes remove them. */
export function applyMessage(
  message: Message,
  change: Extract<MessageEvent['change'], { message: unknown }>['type']
) {
  const parent = message.parent;
  const target = resolveMessageTarget({
    parent,
    messageId: message.id,
    threadId: message.thread_id ?? undefined,
  });
  const normalized = normalizeMessageSender(message);
  const existing = getTargetMessage(parent, target);
  if (change === 'reaction_changed') {
    patchTargetMessage(parent, target, {
      reactions: message.reactions,
      updated_at: message.updated_at,
    });
  } else if (change === 'message_deleted') {
    patchTargetMessage(parent, target, normalized);
    if (target.kind === 'thread_reply' && !existing) {
      // A deletion outside the preview (or one already applied) needs the
      // authoritative count, not another guessed decrement.
      void queryClient.invalidateQueries({
        queryKey: getMessageTimelineQueryKeyPrefix(parent),
      });
      void queryClient.invalidateQueries({
        queryKey: [...messageKeys.messagesByIds._def, parent],
      });
    } else if (
      target.kind === 'thread_reply' ||
      (parent.type === 'channel' &&
        !topLevelMessageHasReplies(parent, message.id))
    ) {
      removeMessageFromTargetCaches(parent, target);
    }
  } else if (change === 'posted' && !existing) {
    if (target.kind === 'thread_reply') {
      insertMessageIntoTargetCaches(parent, target, normalized);
    } else {
      const item: MessageListItem = {
        ...normalized,
        state: {
          root_id: message.id,
          user_id: message.sender_id,
          created_at: message.created_at,
          updated_at: message.created_at,
          resolved: false,
        },
        thread: { reply_count: 0, preview: [], latest_reply_at: null },
      };
      insertMessageIntoTargetCaches(parent, target, item);
    }
  } else {
    patchTargetMessage(parent, target, normalized);
  }
  softInvalidateTargetCaches(parent, target);
}

/** One live message protocol for channel screens, document discussions, and linked drawers. */
export function handleMessageEvent(
  event: MessageEvent,
  currentUserId?: string
) {
  if (!event?.parent || !event.change) return;
  const parent = event.parent;
  const change = event.change;
  if (change.type === 'typing') {
    handleCommsTyping(
      {
        parent,
        user_id: event.actor,
        thread_id: change.thread_id,
        action: change.active ? 'start' : 'stop',
      },
      currentUserId ?? ''
    );
    return;
  }
  if (change.type === 'thread_updated') {
    applyThreadState(parent, change.state);
    return;
  }
  const isRootPost = change.type === 'posted' && !change.message.thread_id;
  const isOwnEcho = consumeNonce(
    change.type === 'reaction_changed'
      ? MessageNonceKeys.REACTION
      : MessageNonceKeys.MESSAGE,
    event.nonce ?? ''
  );
  // A root posted before the bottom page loaded cannot be inserted — the
  // sender's own optimistic insert no-ops there too — so recover it with a
  // fresh fetch once the page settles, even when the echo is the sender's own.
  if (isRootPost && refetchTimelineAwaitingFirstPage(parent)) return;
  if (isOwnEcho) return;
  applyMessage(change.message, change.type);
  if (isRootPost && parent.type === 'document') {
    void loadDocumentRootState(parent, change.message.id);
  }
}

/**
 * A root posted before the bottom page's first fetch resolved cannot be
 * inserted, and a response the server already computed would overwrite it, so
 * that fetch runs again once it settles (invalidating a fetch still in flight
 * only dedupes into it). Slices around a message never need it.
 */
function refetchTimelineAwaitingFirstPage(parent: MessageParent): boolean {
  const queryKey = getMessageTimelineQueryKey(parent, null);
  const query = queryClient
    .getQueryCache()
    .find<MessageTimelineData>({ queryKey, exact: true });
  if (!query || query.state.data) return false;
  const refetch = () =>
    queryClient.invalidateQueries({ queryKey, exact: true });
  const inFlight = query.promise;
  if (inFlight) void inFlight.catch(() => {}).finally(refetch);
  else void refetch();
  return true;
}

/** A live document root arrives without its anchor; its thread state carries it. */
async function loadDocumentRootState(parent: MessageParent, rootId: string) {
  try {
    const thread = await entityMessagesClient.thread(parent, rootId);
    queryClient.setQueryData<MessageThread>(
      getThreadRepliesQueryKey(parent, rootId),
      thread
    );
    applyThreadState(parent, thread.state);
  } catch {
    void queryClient.invalidateQueries({
      queryKey: getMessageTimelineQueryKeyPrefix(parent),
    });
  }
}

export function applyThreadState(
  parent: MessageParent,
  state: MessageThread['state']
) {
  const update = (item: MessageListItem) =>
    item.id === state.root_id ? { ...item, state } : item;
  setMessageTimelineData(
    parent,
    (data) =>
      data && {
        ...data,
        pages: data.pages.map((page) => ({
          ...page,
          entries: page.entries
            .filter(
              (item) =>
                item.type !== 'message' ||
                parent.type === 'document' ||
                !state.deleted_at ||
                item.message.id !== state.root_id
            )
            .map((entry) =>
              entry.type === 'message'
                ? { ...entry, message: update(entry.message) }
                : entry
            ),
        })),
      }
  );
  queryClient.setQueryData<MessageThread>(
    getThreadRepliesQueryKey(parent, state.root_id),
    (thread) =>
      thread
        ? { ...thread, state, replies: state.deleted_at ? [] : thread.replies }
        : undefined
  );
  for (const listener of threadStateListeners) listener(parent, state);
  if (state.deleted_at) {
    // Annotation layout also reads tombstones, including roots outside loaded
    // pages. Fetch the committed state so it survives late document mounting.
    void queryClient.invalidateQueries({
      queryKey: getMessageTimelineQueryKeyPrefix(parent),
    });
  }
}
