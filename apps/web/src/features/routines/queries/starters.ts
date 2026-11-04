import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { enableRoutineCodeSteps } from '@core/constant/featureFlags';
import { throwOnErr } from '@core/util/result';
import { scheduledActionClient } from '@service-scheduled-action/client';
import { queryOptions, useQuery } from '@tanstack/solid-query';
import { stepsFromTask } from '../core/routine-steps';
import type { RoutineTemplate, StarterSteps } from '../core/routine-templates';
import { scheduledActionKeys } from './keys';

const STARTER_KEYS = new Set<string>([
  'inbox',
  'triage',
  'updates',
] satisfies RoutineTemplate['key'][]);

function isStarterKey(key: string): key is RoutineTemplate['key'] {
  return STARTER_KEYS.has(key);
}

/** The scheduler's starter code steps, by template; none where code can't be saved. */
async function fetchStarterSteps(): Promise<StarterSteps> {
  const starters = await throwOnErr(() => scheduledActionClient.codeStarters());
  const steps: StarterSteps = {};
  for (const starter of starters) {
    const parsed = stepsFromTask({ steps: starter.steps });
    if (parsed && isStarterKey(starter.key)) steps[starter.key] = parsed;
  }
  return steps;
}

// The scheduler's starters change only with a release.
export function starterStepsQueryOptions() {
  return queryOptions({
    queryKey: scheduledActionKeys.starters.queryKey,
    queryFn: fetchStarterSteps,
    staleTime: Number.POSITIVE_INFINITY,
  });
}

/**
 * Starter code steps; empty until they load, so templates never wait on them,
 * and without code steps, so templates start as Ask AI.
 */
export function useStarterSteps(): () => StarterSteps {
  const codeSteps = useFeatureFlag(enableRoutineCodeSteps);
  const query = useQuery(() => ({
    ...starterStepsQueryOptions(),
    enabled: codeSteps().enabled,
  }));
  return () => (codeSteps().enabled && query.isSuccess ? query.data : {});
}
