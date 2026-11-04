import type { AgentTypingPhase } from '@service-storage/generated/schemas/agentTypingPhase';
import type { MessageParent } from '@service-storage/messages';
import { entityMessagesClient } from '@service-storage/messages';
import { useMutation } from '@tanstack/solid-query';
import { batch, createSignal } from 'solid-js';
import { parentKey } from './keys';

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
  parent: MessageParent;
  user_id: string;
  action: 'start' | 'stop';
  thread_id?: string | null;
  /** Present when a bot types for an agent session. */
  agent?: { session_id: string; phase: AgentTypingPhase } | null;
};

/** An agent session typing through its bot: whose turn, and what it is doing. */
export type TypingAgent = { sessionId: string; phase: AgentTypingPhase };

/**
 * Ephemeral store for typing indicators.
 * Map<parent, Map<threadId | null, Set<userId>>>
 *
 * Uses null key for main channel, string key for threads.
 */
const [typingUsers, setTypingUsers] = createSignal<TypingUsersByChannel>(
  new Map()
);

const typingTimeouts: TypingTimeoutsByChannel = new Map();

/** What each typing agent is doing, by {@link agentKey}; humans have none. */
const [typingAgents, setTypingAgents] = createSignal<Map<string, TypingAgent>>(
  new Map()
);

const agentKey = (parent: MessageParent, threadId: ThreadId, userId: string) =>
  JSON.stringify([parentKey(parent), threadId, userId]);

function setTypingAgent(
  parent: MessageParent,
  userId: string,
  threadId: ThreadId,
  agent: TypingAgent | undefined
) {
  const key = agentKey(parent, threadId, userId);
  setTypingAgents((prev) => {
    const current = prev.get(key);
    if (
      current?.sessionId === agent?.sessionId &&
      current?.phase === agent?.phase
    )
      return prev;
    const next = new Map(prev);
    if (agent) next.set(key, agent);
    else next.delete(key);
    return next;
  });
}

function withAddedTypingUser(
  prev: TypingUsersByChannel,
  parent: MessageParent,
  userId: string,
  threadId: ThreadId
): TypingUsersByChannel {
  // Agents refresh every few seconds; an unchanged set keeps readers still.
  if (prev.get(parentKey(parent))?.get(threadId)?.has(userId)) return prev;
  const next = new Map(prev);
  const channelMap = new Map(prev.get(parentKey(parent)));
  const threadUsers = new Set(channelMap.get(threadId));

  threadUsers.add(userId);
  channelMap.set(threadId, threadUsers);
  next.set(parentKey(parent), channelMap);

  return next;
}

function withoutTypingUser(
  prev: TypingUsersByChannel,
  parent: MessageParent,
  userId: string,
  threadId: ThreadId
): TypingUsersByChannel {
  const prevChannelMap = prev.get(parentKey(parent));
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
    next.delete(parentKey(parent));
  } else {
    next.set(parentKey(parent), channelMap);
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
  parent: MessageParent,
  userId: string,
  threadId: ThreadId
): void {
  const channelTimeouts = typingTimeouts.get(parentKey(parent));
  const threadTimeouts = channelTimeouts?.get(threadId);
  const timeout = threadTimeouts?.get(userId);

  if (timeout === undefined || !channelTimeouts || !threadTimeouts) return;

  clearTimeout(timeout);
  threadTimeouts.delete(userId);

  if (threadTimeouts.size === 0) channelTimeouts.delete(threadId);
  if (channelTimeouts.size === 0) typingTimeouts.delete(parentKey(parent));
}

function setTypingTimeout(
  parent: MessageParent,
  userId: string,
  threadId: ThreadId
): void {
  removeTypingTimeout(parent, userId, threadId);

  const timeout = setTimeout(() => {
    const currentTimeout = typingTimeouts
      .get(parentKey(parent))
      ?.get(threadId)
      ?.get(userId);
    if (currentTimeout !== timeout) return;

    removeTypingTimeout(parent, userId, threadId);
    removeTypingUser(parent, userId, threadId);
  }, TYPING_INDICATOR_TIMEOUT_MS);

  const channelTimeouts = getOrCreate(
    typingTimeouts,
    parentKey(parent),
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
  setTypingAgents(new Map());
}

function addTypingUser(
  parent: MessageParent,
  userId: string,
  threadId: ThreadId = null,
  agent?: TypingAgent
) {
  batch(() => {
    setTypingUsers((prev) =>
      withAddedTypingUser(prev, parent, userId, threadId)
    );
    setTypingAgent(parent, userId, threadId, agent);
  });
  setTypingTimeout(parent, userId, threadId);
}

function removeTypingUser(
  parent: MessageParent,
  userId: string,
  threadId: ThreadId = null
) {
  removeTypingTimeout(parent, userId, threadId);
  batch(() => {
    setTypingUsers((prev) => {
      return withoutTypingUser(prev, parent, userId, threadId);
    });
    setTypingAgent(parent, userId, threadId, undefined);
  });
}

/**
 * Get the set of user IDs currently typing in a channel/thread.
 */
export function getTypingUsers(
  parent: MessageParent,
  threadId: ThreadId = null
): Set<string> {
  return typingUsers().get(parentKey(parent))?.get(threadId) ?? new Set();
}

/**
 * The typing users in a channel/thread that are agent sessions typing
 * through their bot, with what each is doing.
 */
export function getTypingAgents(
  parent: MessageParent,
  threadId: ThreadId = null
): Map<string, TypingAgent> {
  const agents = typingAgents();
  const typing = new Map<string, TypingAgent>();
  for (const userId of getTypingUsers(parent, threadId)) {
    const agent = agents.get(agentKey(parent, threadId, userId));
    if (agent) typing.set(userId, agent);
  }
  return typing;
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
      payload.parent,
      payload.user_id,
      payload.thread_id ?? null,
      payload.agent
        ? { sessionId: payload.agent.session_id, phase: payload.agent.phase }
        : undefined
    );
  } else {
    removeTypingUser(
      payload.parent,
      payload.user_id,
      payload.thread_id ?? null
    );
  }
}

type PostTypingUpdateVars = {
  parent: MessageParent;
  action: 'start' | 'stop';
  threadId?: string;
};

export function usePostTypingUpdateMutation() {
  return useMutation(() => ({
    gcTime: 0,
    mutationFn: async (vars: PostTypingUpdateVars) => {
      await entityMessagesClient.typing(
        vars.parent,
        vars.threadId ?? null,
        vars.action === 'start'
      );
    },
    onError: (error: Error) => {
      console.error('failed to post typing update', error);
    },
  }));
}
