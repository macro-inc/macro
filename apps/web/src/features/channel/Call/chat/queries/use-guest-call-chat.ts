import { thrownResultErrorHasCode, throwOnErr } from '@core/util/result';
import { queryClient } from '@queries/client';
import { callServiceClient, type GuestChatPage } from '@service-call/client';
import { queryOptions, useMutation, useQuery } from '@tanstack/solid-query';
import { type Accessor, onCleanup } from 'solid-js';
import { guestCallChatKey } from './keys';

function guestCallChatOptions(
  callId: string,
  session: { token: string; participantId: string },
  open: boolean
) {
  return queryOptions({
    queryKey: guestCallChatKey(callId, session.participantId),
    queryFn: () =>
      throwOnErr(() => callServiceClient.getGuestChat(callId, session.token)),
    enabled: open,
    refetchInterval: open ? 3000 : false,
    retry: false,
    gcTime: 0,
  });
}

export function useGuestCallChat(
  callId: Accessor<string>,
  session: Accessor<{ token: string; participantId: string }>,
  open: Accessor<boolean>
) {
  let active = true;
  const key = guestCallChatKey(callId(), session().participantId);
  const query = useQuery(() =>
    guestCallChatOptions(callId(), session(), open())
  );
  const denied = () =>
    query.isError &&
    ['FORBIDDEN', 'UNAUTHORIZED'].some((code) =>
      thrownResultErrorHasCode(query.error, code)
    );
  const send = useMutation(() => ({
    mutationFn: (input: { id: string; content: string }) =>
      throwOnErr(() =>
        callServiceClient.postGuestChat(callId(), session().token, input)
      ),
    onSuccess: (message) => {
      if (!active) return;
      queryClient.setQueryData<GuestChatPage>(key, (current) => ({
        messages: [
          ...(current?.messages ?? []).filter((item) => item.id !== message.id),
          message,
        ],
      }));
    },
  }));
  onCleanup(() => {
    active = false;
    queryClient.removeQueries({ queryKey: key, exact: true });
  });
  return {
    messages: () =>
      !denied() && (query.isSuccess || query.isRefetchError)
        ? (query.data?.messages ?? [])
        : [],
    ready: () => query.isSuccess || (query.isRefetchError && !denied()),
    failed: () => query.isError,
    denied,
    loading: () => query.isPending,
    sending: () => send.isPending,
    send: (input: { id: string; content: string }) => send.mutateAsync(input),
    refresh: () => query.refetch(),
  };
}
