import { storageServiceClient } from '@service-storage/client';
import { useMutation } from '@tanstack/solid-query';
import { createSignal } from 'solid-js';

export const TYPING_INDICATOR_TIMEOUT_MS = 8_000;

type ThreadId = string | null;
type TypingUsersByChannel = Map<string, Map<ThreadId, Set<string>>>;
type TypingTimeoutsByChannel = Map<
  string,
  Map<ThreadId, Map<string, ReturnType<typeof setTimeout>>>
>;

/**
 * Websocket payload type for typing events
 */
type CommsTypingPayload = {
  channel_id: string;
  user_id: string;
  action: 'start' | 'stop';
  thread_id?: string | null;
};

/**
 * Ephemeral store for typing indicators.
 * Map<channelId, Map<threadId | null, Set<userId>>>
 *
 * Uses null key for main channel, string key for threads.
 */
const [typingUsers, setTypingUsers] = createSignal<TypingUsersByChannel>(
  new Map()
);

const typingTimeouts: TypingTimeoutsByChannel = new Map();

function withAddedTypingUser(
  prev: TypingUsersByChannel,
  channelId: string,
  userId: string,
  threadId: ThreadId
): TypingUsersByChannel {
  const next = new Map(prev);
  const channelMap = new Map(prev.get(channelId));
  const threadUsers = new Set(channelMap.get(threadId));

  threadUsers.add(userId);
  channelMap.set(threadId, threadUsers);
  next.set(channelId, channelMap);

  return next;
}

function withoutTypingUser(
  prev: TypingUsersByChannel,
  channelId: string,
  userId: string,
  threadId: ThreadId
): TypingUsersByChannel {
  const prevChannelMap = prev.get(channelId);
  if (!prevChannelMap) return prev;

  const prevThreadUsers = prevChannelMap.get(threadId);
  if (!prevThreadUsers?.has(userId)) return prev;

  const next = new Map(prev);
  const channelMap = new Map(prevChannelMap);
  const threadUsers = new Set(prevThreadUsers);

  threadUsers.delete(userId);
  if (threadUsers.size === 0) {
    channelMap.delete(threadId);
  } else {
    channelMap.set(threadId, threadUsers);
  }

  if (channelMap.size === 0) {
    next.delete(channelId);
  } else {
    next.set(channelId, channelMap);
  }

  return next;
}

function getOrCreate<K, V>(map: Map<K, V>, key: K, createValue: () => V): V {
  if (map.has(key)) return map.get(key) as V;

  const value = createValue();
  map.set(key, value);
  return value;
}

function removeTypingTimeout(
  channelId: string,
  userId: string,
  threadId: ThreadId
): void {
  const channelTimeouts = typingTimeouts.get(channelId);
  const threadTimeouts = channelTimeouts?.get(threadId);
  const timeout = threadTimeouts?.get(userId);

  if (timeout === undefined || !channelTimeouts || !threadTimeouts) return;

  clearTimeout(timeout);
  threadTimeouts.delete(userId);

  if (threadTimeouts.size === 0) channelTimeouts.delete(threadId);
  if (channelTimeouts.size === 0) typingTimeouts.delete(channelId);
}

function setTypingTimeout(
  channelId: string,
  userId: string,
  threadId: ThreadId
): void {
  removeTypingTimeout(channelId, userId, threadId);

  const timeout = setTimeout(() => {
    const currentTimeout = typingTimeouts
      .get(channelId)
      ?.get(threadId)
      ?.get(userId);
    if (currentTimeout !== timeout) return;

    removeTypingTimeout(channelId, userId, threadId);
    removeTypingUser(channelId, userId, threadId);
  }, TYPING_INDICATOR_TIMEOUT_MS);

  const channelTimeouts = getOrCreate(
    typingTimeouts,
    channelId,
    () => new Map<ThreadId, Map<string, ReturnType<typeof setTimeout>>>()
  );
  const threadTimeouts = getOrCreate(
    channelTimeouts,
    threadId,
    () => new Map<string, ReturnType<typeof setTimeout>>()
  );

  threadTimeouts.set(userId, timeout);
}

export function clearTypingIndicators(): void {
  for (const channelTimeouts of typingTimeouts.values()) {
    for (const threadTimeouts of channelTimeouts.values()) {
      for (const timeout of threadTimeouts.values()) {
        clearTimeout(timeout);
      }
    }
  }

  typingTimeouts.clear();
  setTypingUsers(new Map());
}

function addTypingUser(
  channelId: string,
  userId: string,
  threadId: ThreadId = null
) {
  setTypingUsers((prev) =>
    withAddedTypingUser(prev, channelId, userId, threadId)
  );
  setTypingTimeout(channelId, userId, threadId);
}

function removeTypingUser(
  channelId: string,
  userId: string,
  threadId: ThreadId = null
) {
  removeTypingTimeout(channelId, userId, threadId);
  setTypingUsers((prev) => {
    return withoutTypingUser(prev, channelId, userId, threadId);
  });
}

/**
 * Get the set of user IDs currently typing in a channel/thread.
 */
export function getTypingUsersForChannel(
  channelId: string,
  threadId: ThreadId = null
): Set<string> {
  return typingUsers().get(channelId)?.get(threadId) ?? new Set();
}

/**
 * Handle typing indicator from websocket.
 * Ignores typing events from the current user.
 */
export function handleCommsTyping(
  payload: CommsTypingPayload,
  currentUserId: string
): void {
  // Ignore own typing indicators
  if (payload.user_id === currentUserId) return;

  if (payload.action === 'start') {
    addTypingUser(
      payload.channel_id,
      payload.user_id,
      payload.thread_id ?? null
    );
  } else {
    removeTypingUser(
      payload.channel_id,
      payload.user_id,
      payload.thread_id ?? null
    );
  }
}

type PostTypingUpdateVars = {
  channelId: string;
  action: 'start' | 'stop';
  threadId?: string;
};

export function usePostTypingUpdateMutation() {
  return useMutation(() => ({
    gcTime: 0,
    mutationFn: async (vars: PostTypingUpdateVars) => {
      await storageServiceClient.postTypingUpdate({
        channel_id: vars.channelId,
        action: vars.action,
        thread_id: vars.threadId,
      });
    },
    onError: (error: Error) => {
      console.error('failed to post typing update', error);
    },
  }));
}
