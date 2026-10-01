import { throwOnErr } from '@core/util/result';
import type { patchTeamCrmSettings } from '@service-auth/crm';
import type { PatchTeamCrmSettingsRequest } from '@service-auth/generated/schemas/patchTeamCrmSettingsRequest';
import type { PatchTeamCrmSettingsResponse } from '@service-auth/generated/schemas/patchTeamCrmSettingsResponse';
import { useMutation } from '@tanstack/solid-query';
import type { CrmQueryDependencies } from './dependencies';
export function usePatchTeamCrmSettingsMutation(
  deps: CrmQueryDependencies & {
    patch: typeof patchTeamCrmSettings;
    invalidateTeams(): void;
  }
) {
  return useMutation(
    () => ({
      mutationFn: async (req: PatchTeamCrmSettingsRequest) =>
        await throwOnErr(() => deps.patch(req)),
      onSuccess: (data: PatchTeamCrmSettingsResponse) => {
        deps.invalidateTeams();
        deps.feedback.success(data.enabled ? 'CRM enabled' : 'CRM disabled');
      },
      onError: (error: Error) => {
        console.error('Failed to update CRM settings', error);
        deps.feedback.failure('Failed to update CRM settings');
      },
    }),
    () => deps.client
  );
}
