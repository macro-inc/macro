import { useUserId } from '@core/context/user';
import { getDefaultTimezone } from '@core/util/cron';
import { throwOnErr } from '@core/util/result';
import { scheduledActionClient } from '@service-scheduled-action/client';
import type { GenerationOverview } from '@service-scheduled-action/generated/schemas';
import { queryOptions, useQuery, useQueryClient } from '@tanstack/solid-query';
import { match } from 'ts-pattern';
import type { GenerationSource } from '../context/suggestions-source';
import type { Generation, GenerationTrigger } from '../core/generation';
import { useSuggestionsFlag } from '../use-suggestions-flag';
import { suggestionsKeys } from './keys';

/** How often to ask while a generation runs; nothing is asked while idle. */
const GENERATING_POLL_MS = 3_000;

function toGeneration(status: GenerationOverview): Generation {
  const trigger = match(status.trigger)
    .returnType<GenerationTrigger | undefined>()
    .with('onboarding', 'nightly', 'manual', (known) => known)
    .otherwise(() => undefined);

  return {
    state: status.state === 'running' ? 'running' : 'idle',
    ...(trigger ? { trigger } : {}),
    ...(status.startedAt ? { startedAt: status.startedAt } : {}),
    ...(status.regenerateAvailableAt
      ? { regenerateAvailableAt: status.regenerateAvailableAt }
      : {}),
  };
}

export function generationOptions(userId: string, enabled: boolean) {
  return queryOptions({
    ...suggestionsKeys.generation(userId),
    queryFn: async () =>
      toGeneration(
        await throwOnErr(() => scheduledActionClient.suggestionGeneration())
      ),
    enabled,
    // A server without the endpoint answers once; the control stays hidden.
    retry: false,
    refetchInterval: (query) =>
      query.state.data?.state === 'running' ? GENERATING_POLL_MS : false,
  });
}

/**
 * The person's generation status and the refresh request. Read once, then
 * every few seconds only while a generation runs.
 */
export function useSuggestionGeneration(): GenerationSource {
  const enabled = useSuggestionsFlag();
  const userId = useUserId();
  const queryClient = useQueryClient();
  const options = () =>
    generationOptions(userId() ?? '', enabled() && userId() !== undefined);
  const status = useQuery(options);
  const set = (change: (generation: Generation) => Generation) =>
    queryClient.setQueryData(
      options().queryKey,
      (generation: Generation | undefined) =>
        generation ? change(generation) : generation
    );

  return {
    generation: () => status.data,
    async regenerate() {
      const answer = await throwOnErr(() =>
        scheduledActionClient.regenerateSuggestions({
          timezone: getDefaultTimezone(),
        })
      );
      if (answer.kind === 'cooldown') {
        set((generation) => ({
          ...generation,
          regenerateAvailableAt: answer.availableAt,
        }));
        return;
      }

      // Started, or one was already under way: show it running at once and
      // let the next read fill in the rest.
      set((generation) => ({ ...generation, state: 'running' }));
      await status.refetch();
    },
  };
}
