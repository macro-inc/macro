import { commsServiceClient } from '@service-comms/client';
import { useMutation } from '@tanstack/solid-query';
import { createSignal } from 'solid-js';
import { createMutationNonce } from '../nonce';
import { ChannelNonceKeys } from './keys';

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
const [typingUsers, setTypingUsers] = createSignal<
  Map<string, Map<string | null, Set<string>>>
>(new Map());

function addTypingUser(
  channelId: string,
  userId: string,
  threadId: string | null = null
) {
  setTypingUsers((prev) => {
    const newMap = new Map(prev);
    const channelMap =
      newMap.get(channelId) ?? new Map<string | null, Set<string>>();
    const threadUsers = channelMap.get(threadId) ?? new Set<string>();
    channelMap.set(threadId, new Set([...threadUsers, userId]));
    newMap.set(channelId, channelMap);
    return newMap;
  });
}

function removeTypingUser(
  channelId: string,
  userId: string,
  threadId: string | null = null
) {
  setTypingUsers((prev) => {
    const newMap = new Map(prev);
    const channelMap = newMap.get(channelId);
    if (!channelMap) return prev;

    const threadUsers = channelMap.get(threadId);
    if (!threadUsers) return prev;

    const newThreadUsers = new Set(
      [...threadUsers].filter((id) => id !== userId)
    );
    channelMap.set(threadId, newThreadUsers);
    newMap.set(channelId, channelMap);
    return newMap;
  });
}

/**
 * Get the set of user IDs currently typing in a channel/thread.
 */
export function getTypingUsersForChannel(
  channelId: string,
  threadId: string | null = null
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

const typingNonce = createMutationNonce<PostTypingUpdateVars>(
  ChannelNonceKeys.TYPING,
  (v) => `${v.channelId}:${v.action}:${v.threadId ?? 'main'}`
);

export function usePostTypingUpdateMutation() {
  return useMutation(() => ({
    gcTime: 0,
    mutationFn: async (vars: PostTypingUpdateVars) => {
      await commsServiceClient.postTypingUpdate({
        channel_id: vars.channelId,
        action: vars.action,
        thread_id: vars.threadId,
        nonce: typingNonce.use(vars),
      });
    },
    onMutate: (vars: PostTypingUpdateVars) => {
      typingNonce.prepare(vars);
    },
    onSettled: (
      _data: unknown,
      _error: Error | null,
      vars: PostTypingUpdateVars
    ) => {
      typingNonce.cleanup(vars);
    },
    onError: (error: Error) => {
      console.error('failed to post typing update', error);
    },
  }));
}
