import { throwOnErr } from '@core/util/result';
import type { CrmStageInput } from '@service-storage/generated/schemas/crmStageInput';
import { useMutation } from '@tanstack/solid-query';
import { soupKeys } from '../../../lib/queries/soup/keys';
import type { CrmQueryDependencies } from './dependencies';
import { CRM_TEAM_SETTINGS_QUERY_KEY } from './team-config';

function invalidateStageReaders(deps: CrmQueryDependencies) {
  return Promise.all([
    deps.client.invalidateQueries({
      predicate: ({ queryKey }) =>
        queryKey.includes('properties') && queryKey.includes('definitions'),
    }),
    deps.client.invalidateQueries({ queryKey: soupKeys._def }),
    deps.client.invalidateQueries({ queryKey: CRM_TEAM_SETTINGS_QUERY_KEY }),
  ]);
}

export function useReplaceCrmStagesMutation(deps: CrmQueryDependencies) {
  return useMutation(
    () => ({
      mutationFn: (stages: CrmStageInput[]) =>
        throwOnErr(() => deps.storage.replaceCrmTeamStages({ stages })),
      onSuccess: () => invalidateStageReaders(deps),
      onError: (error: Error) => {
        console.error('Failed to update deal stages', error);
        deps.feedback.failure('Failed to update deal stages');
      },
    }),
    () => deps.client
  );
}

export function useResetCrmStagesMutation(deps: CrmQueryDependencies) {
  return useMutation(
    () => ({
      mutationFn: () => throwOnErr(() => deps.storage.resetCrmTeamStages()),
      onSuccess: () => invalidateStageReaders(deps),
      onError: (error: Error) => {
        console.error('Failed to reset deal stages', error);
        deps.feedback.failure('Failed to reset deal stages');
      },
    }),
    () => deps.client
  );
}
