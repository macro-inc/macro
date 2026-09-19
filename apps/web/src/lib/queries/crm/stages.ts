import { CRM_TEAM_SETTINGS_QUERY_KEY } from '@companies/crm/team-crm-config';
import { toast } from '@core/component/Toast/Toast';
import { throwOnErr } from '@core/util/result';
import { storageServiceClient } from '@service-storage/client';
import type { CrmStageInput } from '@service-storage/generated/schemas/crmStageInput';
import { useMutation } from '@tanstack/solid-query';
import { queryClient } from '../client';
import { soupKeys } from '../soup/keys';

function invalidateStageReaders() {
  return Promise.all([
    queryClient.invalidateQueries({
      predicate: ({ queryKey }) =>
        queryKey.includes('properties') && queryKey.includes('definitions'),
    }),
    queryClient.invalidateQueries({ queryKey: soupKeys._def }),
    queryClient.invalidateQueries({ queryKey: CRM_TEAM_SETTINGS_QUERY_KEY }),
  ]);
}

export function useReplaceCrmStagesMutation() {
  return useMutation(() => ({
    mutationFn: (stages: CrmStageInput[]) =>
      throwOnErr(() => storageServiceClient.replaceCrmTeamStages({ stages })),
    onSuccess: () => invalidateStageReaders(),
    onError: (error: Error) => {
      console.error('Failed to update deal stages', error);
      toast.failure('Failed to update deal stages');
    },
  }));
}

export function useResetCrmStagesMutation() {
  return useMutation(() => ({
    mutationFn: () =>
      throwOnErr(() => storageServiceClient.resetCrmTeamStages()),
    onSuccess: () => invalidateStageReaders(),
    onError: (error: Error) => {
      console.error('Failed to reset deal stages', error);
      toast.failure('Failed to reset deal stages');
    },
  }));
}
