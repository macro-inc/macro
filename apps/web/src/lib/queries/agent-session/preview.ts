import { throwOnErr } from '@core/util/result';
import { useQuery, useQueryClient } from '@tanstack/solid-query';
import { type Accessor, onCleanup } from 'solid-js';
import { previewServiceClient } from '../../service-clients/service-preview/client';
import { subscribeSocketSessionStarted } from './queue-sync';

const listeners = new Set<(sessionId: string) => void>();
/** Paired with preview_gateway's agent_session_preview invalidation event. */
export function handleAgentSessionPreview(event: { agentSessionId: string }) {
  for (const listener of listeners) listener(event.agentSessionId);
}
const key = (sessionId: string | undefined) =>
  ['agentSession', 'preview', sessionId ?? ''] as const;

export function useAgentPreview(sessionId: Accessor<string | undefined>) {
  const client = useQueryClient();
  const invalidate = () =>
    client.invalidateQueries({ queryKey: key(sessionId()) });
  const listener = (id: string) => {
    if (id === sessionId()) void invalidate();
  };
  listeners.add(listener);
  onCleanup(() => listeners.delete(listener));
  onCleanup(subscribeSocketSessionStarted(() => void invalidate()));
  const query = useQuery(() => ({
    queryKey: key(sessionId()),
    queryFn: () => throwOnErr(() => previewServiceClient.get(sessionId()!)),
    enabled: Boolean(sessionId()),
    staleTime: 0,
    // Repairs missed events and gateway restarts; also renews the viewer's event subscription.
    refetchInterval: 30_000,
    retry: false,
  }));
  return {
    query,
    open: () => throwOnErr(() => previewServiceClient.open(sessionId()!)),
    stop: async () => {
      await throwOnErr(() => previewServiceClient.stop(sessionId()!));
      await invalidate();
    },
  };
}
