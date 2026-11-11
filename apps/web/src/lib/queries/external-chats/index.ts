import type {
  ChatDetail,
  ChatSend,
  ChatSummary,
  MessagePage,
  SendFailure,
  SendProgress,
} from '@app/features/external-chat/core/chat';
import {
  infiniteQueryOptions,
  type QueryKey,
  queryOptions,
  useInfiniteQuery,
  useQuery,
} from '@tanstack/solid-query';
import type { Result } from 'neverthrow';
import type { Accessor } from 'solid-js';
import { queryClient } from '../client';
import { externalChatsKeys } from './keys';

/** Decoded chat operations. Production decodes generated DSS types before this seam. */
export type ExternalChatApi = {
  list: () => Promise<ChatSummary[]>;
  detail: (chatId: string) => Promise<ChatDetail>;
  messages: (chatId: string, before?: string) => Promise<MessagePage>;
  /** Records one deliberate send; DSS dedupes by the idempotency key. */
  send: (
    chatId: string,
    request: ChatSend,
    idempotencyKey: string
  ) => Promise<Result<SendProgress, SendFailure>>;
  /** The caller's progress for recorded sends, by send id. */
  delivery: (chatId: string, sendIds: string[]) => Promise<SendProgress[]>;
  upload: (
    chatId: string,
    file: File
  ) => Promise<Result<{ uploadId: string; audio: boolean }, SendFailure>>;
  markRead: (chatId: string, messageId: string) => Promise<unknown>;
  stopSync: (chatId: string) => Promise<unknown>;
  /**
   * Asks the owner's phone for the earlier messages of their chats waiting
   * for it (WhatsApp imports per account, not per chat).
   */
  importHistory: () => Promise<unknown>;
};

// DSS pushes `external_chat_changed` through the connection gateway (`./sync`);
// these reads do not poll.
function listOptions(api: ExternalChatApi, userId: string) {
  return queryOptions({
    queryKey: externalChatsKeys.list(userId).queryKey,
    queryFn: api.list,
    enabled: !!userId,
    staleTime: 5000,
    throwOnError: false,
  });
}
function detailOptions(api: ExternalChatApi, userId: string, chatId: string) {
  return queryOptions({
    queryKey: externalChatsKeys.detail(userId, chatId).queryKey,
    queryFn: () => api.detail(chatId),
    enabled: !!userId && !!chatId,
    staleTime: 5000,
    throwOnError: false,
  });
}
function messagesOptions(api: ExternalChatApi, userId: string, chatId: string) {
  return infiniteQueryOptions({
    queryKey: externalChatsKeys.messages(userId, chatId).queryKey,
    queryFn: ({ pageParam }) => api.messages(chatId, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.before,
    enabled: !!userId && !!chatId,
    staleTime: 0,
    throwOnError: false,
  });
}
/** Outcomes of this viewer's in-flight sends; checked again on every push. */
const DELIVERY_CHECK_MS = 5000;
function deliveryOptions(
  api: ExternalChatApi,
  userId: string,
  chatId: string,
  sendIds: string[]
) {
  return queryOptions({
    queryKey: externalChatsKeys.delivery(userId, chatId)._ctx.sends(sendIds)
      .queryKey,
    queryFn: () => api.delivery(chatId, sendIds),
    enabled: !!userId && !!chatId && sendIds.length > 0,
    staleTime: 0,
    // A missed push must not leave a sent message pending forever.
    refetchInterval: DELIVERY_CHECK_MS,
    refetchIntervalInBackground: false,
    throwOnError: false,
  });
}
export function useExternalChatsQuery(
  api: ExternalChatApi,
  userId: Accessor<string>
) {
  return useQuery(() => listOptions(api, userId()));
}
export function useExternalChatQueries(
  api: ExternalChatApi,
  userId: Accessor<string>,
  chatId: Accessor<string>
) {
  const chat = useQuery(() => detailOptions(api, userId(), chatId()));
  const messages = useInfiniteQuery(() =>
    messagesOptions(api, userId(), chatId())
  );
  return { chat, messages };
}
/** One chat's detail alone, e.g. to name a mention of it. */
export function useExternalChatDetailQuery(
  api: ExternalChatApi,
  userId: Accessor<string>,
  chatId: Accessor<string>
) {
  return useQuery(() => detailOptions(api, userId(), chatId()));
}
export function useExternalChatDeliveryQuery(
  api: ExternalChatApi,
  userId: Accessor<string>,
  chatId: Accessor<string>,
  sendIds: Accessor<string[]>
) {
  return useQuery(() => deliveryOptions(api, userId(), chatId(), sendIds()));
}
/** Unread counts and names in every chat list. */
export function invalidateExternalChatList() {
  return queryClient.invalidateQueries({
    queryKey: externalChatsKeys.list._def,
  });
}
/**
 * One chat changed for everyone who reads it (sharing, syncing): its
 * detail, whoever's cache holds it, and every chat list. Its timeline is
 * unchanged.
 */
export function invalidateExternalChat(chatId: string) {
  queryClient.invalidateQueries({ queryKey: externalChatsKeys.list._def });
  queryClient.invalidateQueries({
    queryKey: externalChatsKeys.detail._def,
    predicate: (query) => query.queryKey.at(-1) === chatId,
  });
}
/**
 * How long a refresh waits for an older page. The request has no timeout of its
 * own, so a hung one would otherwise block every refresh of this chat.
 */
const OLDER_PAGE_WAIT_MS = 10_000;

/**
 * Waits while an older page loads. Looks again after each wait, because loading
 * history can replace the fetch that was being waited on (a quote click does).
 * The limit covers the whole wait, so replacements can't extend it.
 */
async function waitForOlderPage(queryKey: QueryKey) {
  const deadline = Date.now() + OLDER_PAGE_WAIT_MS;
  for (;;) {
    const query = queryClient.getQueryCache().find({ queryKey });
    const loadingOlder =
      query?.state.fetchStatus === 'fetching' &&
      query.state.fetchMeta?.fetchMore;
    const remaining = deadline - Date.now();
    if (!loadingOlder || remaining <= 0) return;

    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      Promise.allSettled([query.promise]),
      new Promise((done) => {
        timer = setTimeout(done, remaining);
      }),
    ]);
    clearTimeout(timer);
  }
}

/**
 * Refetches one chat's timeline. A refetch cancels whatever fetch is in flight,
 * and when that is the older page a viewer asked for, the page is lost and the
 * button just reappears, so wait for it first, up to a limit.
 */
export async function invalidateExternalChatMessages(
  userId: string,
  chatId: string
) {
  const queryKey = externalChatsKeys.messages(userId, chatId).queryKey;
  await waitForOlderPage(queryKey);
  return queryClient.invalidateQueries({ queryKey });
}
/** A send was recorded: its row and the chat's place in lists follow. */
export function refreshExternalChatTimeline(userId: string, chatId: string) {
  return Promise.all([
    invalidateExternalChatMessages(userId, chatId),
    queryClient.invalidateQueries({
      queryKey: externalChatsKeys.delivery(userId, chatId).queryKey,
    }),
  ]);
}
