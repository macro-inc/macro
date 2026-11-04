import { throwOnErr } from '@core/util/result';
import { queryClient } from '@queries/client';
import { cognitionApiServiceClient } from '@service-cognition/client';
import type { DialpadBackfill } from '@service-cognition/generated/schemas/dialpadBackfill';
import type { DialpadConnectionResponse } from '@service-cognition/generated/schemas/dialpadConnectionResponse';
import { useMutation, useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';

const KEYS = {
  connection: ['dialpad', 'connection'] as const,
};

function fetchDialpadConnection() {
  return throwOnErr(
    async () => await cognitionApiServiceClient.getDialpadConnection()
  );
}

function dialpadConnectionQueryOptions() {
  return {
    queryKey: KEYS.connection,
    queryFn: fetchDialpadConnection,
    refetchOnWindowFocus: 'always' as const,
  };
}

/** The user's Dialpad call sync. */
export function useDialpadConnectionQuery(enabled: Accessor<boolean>) {
  return useQuery(() => ({
    ...dialpadConnectionQueryOptions(),
    enabled: enabled(),
  }));
}

/**
 * Record a connection state the server just answered. A fetch already in
 * flight started before it and would overwrite it with the old state, so it
 * is cancelled first.
 */
async function setConnection(connection: DialpadConnectionResponse) {
  await queryClient.cancelQueries({ queryKey: KEYS.connection });
  queryClient.setQueryData(KEYS.connection, connection);
}

/** Start connecting; resolves to the Macro Connect URL to open. */
export function useConnectDialpadMutation() {
  return useMutation(() => ({
    mutationFn: async (backfill: DialpadBackfill) => {
      const { connectUrl } = await throwOnErr(
        async () => await cognitionApiServiceClient.connectDialpad({ backfill })
      );
      return connectUrl;
    },
    onSuccess: () => setConnection({ state: 'connecting' }),
  }));
}

/** Finish connecting now rather than at the backend's next pass. */
export function useCompleteDialpadMutation() {
  return useMutation(() => ({
    mutationFn: async () =>
      await throwOnErr(
        async () => await cognitionApiServiceClient.completeDialpadConnection()
      ),
    onSuccess: setConnection,
  }));
}

export function useDisconnectDialpadMutation() {
  return useMutation(() => ({
    mutationFn: async () =>
      await throwOnErr(
        async () => await cognitionApiServiceClient.disconnectDialpad()
      ),
    onSuccess: () => setConnection({ state: 'not_connected' }),
  }));
}
