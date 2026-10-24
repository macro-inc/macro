import type {
  GroupDetail,
  GroupSend,
  GroupSummary,
  MessagePage,
  PendingSend,
} from '@app/features/whatsapp-group/core/group';
import {
  infiniteQueryOptions,
  queryOptions,
  useInfiniteQuery,
  useMutation,
  useQuery,
} from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { queryClient } from '../client';
import { whatsappOperation } from '../whatsapp-linked/operation';
import { whatsappGroupsKeys } from './keys';

/** Decoded group operations. Production decodes generated DSS types before this seam. */
export type WhatsAppGroupApi = {
  list: () => Promise<GroupSummary[]>;
  detail: (groupId: string) => Promise<GroupDetail>;
  messages: (groupId: string, before?: string) => Promise<MessagePage>;
  sends: (groupId: string) => Promise<PendingSend[]>;
  send: (
    groupId: string,
    request: GroupSend,
    idempotencyKey: string
  ) => Promise<unknown>;
  upload: (
    groupId: string,
    file: File
  ) => Promise<{ uploadId: string; audio: boolean }>;
  markRead: (groupId: string, messageId: string) => Promise<unknown>;
  stopSync: (groupId: string) => Promise<unknown>;
};

function listOptions(api: WhatsAppGroupApi, userId: string) {
  return queryOptions({
    queryKey: whatsappGroupsKeys.list(userId).queryKey,
    queryFn: api.list,
    enabled: !!userId,
    staleTime: 5000,
    refetchInterval: 15000,
    refetchIntervalInBackground: false,
    throwOnError: false,
  });
}
function detailOptions(api: WhatsAppGroupApi, userId: string, groupId: string) {
  return queryOptions({
    queryKey: whatsappGroupsKeys.detail(userId, groupId).queryKey,
    queryFn: () => api.detail(groupId),
    enabled: !!userId && !!groupId,
    staleTime: 5000,
    refetchInterval: 15000,
    refetchIntervalInBackground: false,
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
    refetchInterval: 5000,
    refetchIntervalInBackground: false,
    throwOnError: false,
  });
}
function sendsOptions(api: WhatsAppGroupApi, userId: string, groupId: string) {
  return queryOptions({
    queryKey: whatsappGroupsKeys.sends(userId, groupId).queryKey,
    queryFn: () => api.sends(groupId),
    enabled: !!userId && !!groupId,
    staleTime: 0,
    refetchInterval: 5000,
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
  const sends = useQuery(() => sendsOptions(api, userId(), groupId()));
  const send = useMutation(() => ({
    mutationFn: (input: {
      userId: string;
      groupId: string;
      request: GroupSend;
      idempotencyKey: string;
    }) =>
      whatsappOperation(
        'group.send',
        () => api.send(input.groupId, input.request, input.idempotencyKey),
        input.groupId
      ),
    // Pending/unknown sends refresh independently; never retry a write.
    retry: false,
    onSuccess: (_result, input) =>
      Promise.all([
        queryClient.invalidateQueries({
          queryKey: whatsappGroupsKeys.sends(input.userId, input.groupId)
            .queryKey,
        }),
        queryClient.invalidateQueries({
          queryKey: whatsappGroupsKeys.messages(input.userId, input.groupId)
            .queryKey,
        }),
      ]),
  }));
  return { group, messages, sends, send };
}
export function invalidateWhatsappGroups() {
  return queryClient.invalidateQueries({ queryKey: whatsappGroupsKeys._def });
}
