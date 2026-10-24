import type {
  GroupDetail,
  GroupSend,
  GroupSummary,
  MessagePage,
  SendFailure,
  SendProgress,
} from '@app/features/whatsapp-group/core/group';
import {
  infiniteQueryOptions,
  queryOptions,
  useInfiniteQuery,
  useQuery,
} from '@tanstack/solid-query';
import type { Result } from 'neverthrow';
import type { Accessor } from 'solid-js';
import { queryClient } from '../client';
import { whatsappGroupsKeys } from './keys';

/** Decoded group operations. Production decodes generated DSS types before this seam. */
export type WhatsAppGroupApi = {
  list: () => Promise<GroupSummary[]>;
  detail: (groupId: string) => Promise<GroupDetail>;
  messages: (groupId: string, before?: string) => Promise<MessagePage>;
  /** Records one deliberate send; DSS dedupes by the idempotency key. */
  send: (
    groupId: string,
    request: GroupSend,
    idempotencyKey: string
  ) => Promise<Result<SendProgress, SendFailure>>;
  /** The caller's progress for recorded sends, by send id. */
  delivery: (groupId: string, sendIds: string[]) => Promise<SendProgress[]>;
  upload: (
    groupId: string,
    file: File
  ) => Promise<Result<{ uploadId: string; audio: boolean }, SendFailure>>;
  markRead: (groupId: string, messageId: string) => Promise<unknown>;
  stopSync: (groupId: string) => Promise<unknown>;
};

// DSS pushes `whatsapp_changed` through the connection gateway (`./sync`);
// these reads do not poll.
function listOptions(api: WhatsAppGroupApi, userId: string) {
  return queryOptions({
    queryKey: whatsappGroupsKeys.list(userId).queryKey,
    queryFn: api.list,
    enabled: !!userId,
    staleTime: 5000,
    throwOnError: false,
  });
}
function detailOptions(api: WhatsAppGroupApi, userId: string, groupId: string) {
  return queryOptions({
    queryKey: whatsappGroupsKeys.detail(userId, groupId).queryKey,
    queryFn: () => api.detail(groupId),
    enabled: !!userId && !!groupId,
    staleTime: 5000,
    throwOnError: false,
  });
}
function messagesOptions(
  api: WhatsAppGroupApi,
  userId: string,
  groupId: string
) {
  return infiniteQueryOptions({
    queryKey: whatsappGroupsKeys.messages(userId, groupId).queryKey,
    queryFn: ({ pageParam }) => api.messages(groupId, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.before,
    enabled: !!userId && !!groupId,
    staleTime: 0,
    throwOnError: false,
  });
}
/** Outcomes of this viewer's in-flight sends; checked again on every push. */
const DELIVERY_CHECK_MS = 5000;
function deliveryOptions(
  api: WhatsAppGroupApi,
  userId: string,
  groupId: string,
  sendIds: string[]
) {
  return queryOptions({
    queryKey: whatsappGroupsKeys.delivery(userId, groupId)._ctx.sends(sendIds)
      .queryKey,
    queryFn: () => api.delivery(groupId, sendIds),
    enabled: !!userId && !!groupId && sendIds.length > 0,
    staleTime: 0,
    // A missed push must not leave a sent message pending forever.
    refetchInterval: DELIVERY_CHECK_MS,
    refetchIntervalInBackground: false,
    throwOnError: false,
  });
}
export function useWhatsappGroupsQuery(
  api: WhatsAppGroupApi,
  userId: Accessor<string>
) {
  return useQuery(() => listOptions(api, userId()));
}
export function useWhatsappGroupQueries(
  api: WhatsAppGroupApi,
  userId: Accessor<string>,
  groupId: Accessor<string>
) {
  const group = useQuery(() => detailOptions(api, userId(), groupId()));
  const messages = useInfiniteQuery(() =>
    messagesOptions(api, userId(), groupId())
  );
  return { group, messages };
}
export function useWhatsappGroupDeliveryQuery(
  api: WhatsAppGroupApi,
  userId: Accessor<string>,
  groupId: Accessor<string>,
  sendIds: Accessor<string[]>
) {
  return useQuery(() => deliveryOptions(api, userId(), groupId(), sendIds()));
}
/** Unread counts and names in every group list. */
export function invalidateWhatsappGroupList() {
  return queryClient.invalidateQueries({
    queryKey: whatsappGroupsKeys.list._def,
  });
}
export function invalidateWhatsappGroups() {
  return queryClient.invalidateQueries({ queryKey: whatsappGroupsKeys._def });
}
/** A send was recorded: its row and the group's place in lists follow. */
export function refreshWhatsappGroupTimeline(userId: string, groupId: string) {
  return Promise.all([
    queryClient.invalidateQueries({
      queryKey: whatsappGroupsKeys.messages(userId, groupId).queryKey,
    }),
    queryClient.invalidateQueries({
      queryKey: whatsappGroupsKeys.delivery(userId, groupId).queryKey,
    }),
  ]);
}
