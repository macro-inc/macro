import { thrownResultErrorHasCode, throwOnErr } from '@core/util/result';
import { queryClient } from '@queries/client';
import { callServiceClient } from '@service-call/client';
import { queryOptions, useQuery } from '@tanstack/solid-query';
import { type Accessor, onCleanup } from 'solid-js';
import { guestCallChatKey } from './keys';

type GuestSession = { token: string; participantId: string };

function guestCallThreadOptions(
  callId: string,
  session: GuestSession,
  open: boolean
) {
  return queryOptions({
    queryKey: guestCallChatKey(callId, session.participantId),
    queryFn: () =>
      throwOnErr(() =>
        callServiceClient.getGuestChatThread(callId, session.token)
      ),
    enabled: open,
    refetchInterval: open ? 3000 : false,
    retry: false,
    gcTime: 0,
  });
}

export function useGuestCallThread(
  callId: Accessor<string>,
  session: Accessor<GuestSession>,
  open: Accessor<boolean>
) {
  const key = guestCallChatKey(callId(), session().participantId);
  const query = useQuery(() =>
    guestCallThreadOptions(callId(), session(), open())
  );
  const denied = () =>
    query.isError &&
    ['FORBIDDEN', 'UNAUTHORIZED'].some((code) =>
      thrownResultErrorHasCode(query.error, code)
    );
  const current = () =>
    !denied() && (query.isSuccess || query.isRefetchError)
      ? query.data
      : undefined;
  const refresh = () => query.refetch();

  onCleanup(() => queryClient.removeQueries({ queryKey: key, exact: true }));

  return {
    parent: () => ({ type: 'call' as const, id: callId() }),
    thread: () => current()?.thread ?? undefined,
    viewerId: () => current()?.viewer_id,
    empty: () => current()?.thread === null,
    loading: () => query.isPending,
    failed: () => query.isError,
    denied,
    refresh,
    async send(input: { id: string; content: string }) {
      await throwOnErr(() =>
        callServiceClient.postGuestChatMessage(callId(), session().token, input)
      );
      await refresh();
    },
    async patch(id: string, content: string) {
      await throwOnErr(() =>
        callServiceClient.patchGuestChatMessage(callId(), session().token, id, {
          content,
        })
      );
      await refresh();
    },
    async remove(id: string) {
      await throwOnErr(() =>
        callServiceClient.deleteGuestChatMessage(callId(), session().token, id)
      );
      await refresh();
    },
    async react(id: string, emoji: string, add: boolean) {
      await throwOnErr(() =>
        callServiceClient.reactGuestChatMessage(callId(), session().token, id, {
          emoji,
          add,
        })
      );
      await refresh();
    },
  };
}
