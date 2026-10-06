import { MACRO_NEW_BOT_ID } from '@core/constant/macroNew';
import { throwOnErr } from '@core/util/result';
import { agentHarnessServiceClient } from '@service-agent-harness/client';
import { type QueryClient, useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { v7 as uuidv7 } from 'uuid';
import { queryClient } from '../client';
import { agentSessionWarmKeys } from './keys';

const CLIENT_WARM_TTL_MS = 5 * 60 * 1000;
type WarmSession = {
  id: string;
  model: string;
  instructions?: string | null;
  expires: number;
};

/** Best-effort speculation; never read its data into a Suspense boundary. */
export function useWarmAgentSessionQuery(userId: Accessor<string | undefined>) {
  return useQuery(() => {
    const owner = userId();
    return {
      queryKey: agentSessionWarmKeys.owner(owner).queryKey,
      enabled: !!owner,
      staleTime: CLIENT_WARM_TTL_MS,
      gcTime: CLIENT_WARM_TTL_MS,
      retry: false,
      refetchOnWindowFocus: false,
      queryFn: async ({ signal }: { signal: AbortSignal }) => {
        if (!owner) return null;
        const result = await throwOnErr(() =>
          agentHarnessServiceClient.warm(uuidv7(), signal)
        );
        if (result.session) {
          return {
            id: result.session.id,
            model: result.session.model,
            instructions: result.session.instructions,
            expires: Date.now() + CLIENT_WARM_TTL_MS,
          } satisfies WarmSession;
        }
        return null;
      },
    };
  });
}

/** Consume once, only for the owner and exact default-agent configuration. */
export function takeWarmAgentSession(
  options: {
    userId?: string;
    botId?: string;
    modelOverride?: string;
    instructions?: string;
    repoUrl?: string;
  },
  client: QueryClient = queryClient
): string | undefined {
  if (
    !options.userId ||
    (options.botId && options.botId !== MACRO_NEW_BOT_ID) ||
    options.repoUrl
  )
    return;
  const key = agentSessionWarmKeys.owner(options.userId).queryKey;
  const entry = client.getQueryData<WarmSession | null>(key);
  if (!entry) return;
  if (entry.expires <= Date.now()) {
    client.setQueryData(key, null);
    return;
  }
  if (options.modelOverride && options.modelOverride !== entry.model) return;
  if (
    (options.instructions?.trim() || '') !== (entry.instructions?.trim() || '')
  )
    return;
  client.setQueryData(key, null);
  return entry.id;
}
