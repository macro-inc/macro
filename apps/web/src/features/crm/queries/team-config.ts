import {
  assertQueryAccount,
  isCurrentQueryAccount,
  mutationQueryAccount,
} from '@app/lib/queries/auth/account-scope';
import { useQueryAccount } from '@app/lib/queries/auth/use-query-account';
import { captureQueryAuthorization } from '@app/lib/urql-solid/authorization';
import type {
  TeamCrmConfig,
  TeamCrmConfigPatch,
  TeamCrmSavedView,
} from '../core/team-config';
import type { CrmQueryDependencies } from './dependencies';
import { parseTeamViews } from './team-view-codec';

export type {
  CrmPermissionRole,
  CrmPermissions,
  TeamCrmConfig,
  TeamCrmConfigPatch,
  TeamCrmSavedView,
} from '../core/team-config';

/**
 * Team-shared CRM configuration (permissions, team saved views, display
 * defaults).
 *
 * Stored on `team_crm_settings` and served by GET/PUT `/crm/settings`
 * (document storage service). Any team member can read and can update
 * the views fields (`teamViews`, `defaultTeamViewId`); the governance
 * fields (permission thresholds) are admin/owner-gated server-side.
 * Updates are field-wise partial: omitted fields keep their current
 * values, `null` clears the nullable ones, and `teamViews` is replaced
 * whole (last write wins).
 */

import { throwOnErr } from '@core/util/result';
import type { UpdateCrmTeamSettingsRequest } from '@service-storage/generated/schemas/updateCrmTeamSettingsRequest';
import { queryOptions, useMutation, useQuery } from '@tanstack/solid-query';
import { createMemo } from 'solid-js';

export const CRM_TEAM_SETTINGS_QUERY_KEY = ['crm', 'team-settings'] as const;

function teamCrmSettingsQueryOptions(deps: CrmQueryDependencies) {
  return queryOptions({
    queryKey: CRM_TEAM_SETTINGS_QUERY_KEY,
    queryFn: async () =>
      await throwOnErr(() => deps.storage.getCrmTeamSettings()),
  });
}

export function useTeamCrmConfig(deps: CrmQueryDependencies) {
  const queryClient = deps.client;
  const account = useQueryAccount();

  const settingsQuery = useQuery(
    () => teamCrmSettingsQueryOptions(deps),
    () => deps.client
  );

  const config = createMemo((): TeamCrmConfig => {
    const data = settingsQuery.isSuccess ? settingsQuery.data : undefined;
    if (!data) return {};
    return {
      permissions: {
        editStages: data.edit_stages_role,
        moveClosedDeals: data.move_closed_deals_role,
        deleteRecords: data.delete_records_role,
      },
      legacyStageIds: data.legacy_stage_ids ?? undefined,
      teamViews: parseTeamViews(data.team_views),
      defaultTeamViewId: data.default_team_view_id ?? undefined,
      excludePersonalEmails: data.exclude_personal_emails,
    };
  });

  const updateMutation = useMutation(
    () => ({
      meta: { queryAccount: account() },
      onMutate: () => captureQueryAuthorization(),
      // Serialize updates: with whole-list team_views writes, concurrent
      // PUTs would clobber each other. Scoped mutations run one at a time,
      // and updater-style patches fetch a fresh baseline after the previous
      // mutation settles, even if its response could not enter the cache.
      scope: { id: 'crm-team-settings' },
      mutationFn: async (patch: TeamCrmConfigPatch, context) => {
        const owner = mutationQueryAccount(context);
        assertQueryAccount(owner);
        let teamViews: TeamCrmSavedView[] | undefined;
        if (typeof patch.teamViews === 'function') {
          const settings = await throwOnErr(() =>
            deps.storage.getCrmTeamSettings()
          );
          assertQueryAccount(owner);
          teamViews = patch.teamViews(parseTeamViews(settings.team_views));
        } else {
          teamViews = patch.teamViews;
        }
        const body: UpdateCrmTeamSettingsRequest = {
          edit_stages_role: patch.permissions?.editStages,
          move_closed_deals_role: patch.permissions?.moveClosedDeals,
          delete_records_role: patch.permissions?.deleteRecords,
          ...(teamViews !== undefined ? { team_views: teamViews } : {}),
          ...(patch.defaultTeamViewId !== undefined
            ? { default_team_view_id: patch.defaultTeamViewId }
            : {}),
          exclude_personal_emails: patch.excludePersonalEmails,
        };
        assertQueryAccount(owner);
        return await throwOnErr(() => deps.storage.updateCrmTeamSettings(body));
      },
      onSuccess: (settings, _variables, canCache, context) => {
        if (
          !isCurrentQueryAccount(mutationQueryAccount(context)) ||
          !canCache?.()
        )
          return;
        // The PUT returns the resulting row — seed the cache with it.
        queryClient.setQueryData(CRM_TEAM_SETTINGS_QUERY_KEY, settings);
      },
      onSettled: (_settings, _error, _variables, _result, context) => {
        if (!isCurrentQueryAccount(mutationQueryAccount(context))) return;
        return queryClient.invalidateQueries({
          queryKey: CRM_TEAM_SETTINGS_QUERY_KEY,
        });
      },
    }),
    () => deps.client
  );

  return {
    config,
    isLoading: () => settingsQuery.isLoading,
    isError: () => settingsQuery.isError && settingsQuery.data === undefined,
    update: updateMutation,
  };
}
