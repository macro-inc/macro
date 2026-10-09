import type { TeamCrmConfig, TeamCrmConfigPatch } from '../core/team-config';
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
 * Team-shared CRM configuration (permissions, closed-stage set, team saved
 * views, display defaults).
 *
 * Stored on `team_crm_settings` and served by GET/PUT `/crm/settings`
 * (document storage service). Any team member can read and can update
 * the views fields (`teamViews`, `defaultTeamViewId`); the governance
 * fields (permission thresholds, `closedStageIds`) are admin/owner-gated
 * server-side. Updates are field-wise partial: omitted fields keep their
 * current values, `null` clears the nullable ones, and `teamViews` is
 * replaced whole (last write wins).
 */

import { throwOnErr } from '@core/util/result';
import type { CrmTeamSettingsResponse } from '@service-storage/generated/schemas/crmTeamSettingsResponse';
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
      closedStageIds: data.closed_stage_ids ?? undefined,
      legacyStageIds: data.legacy_stage_ids ?? undefined,
      teamViews: parseTeamViews(data.team_views),
      defaultTeamViewId: data.default_team_view_id ?? undefined,
    };
  });

  const updateMutation = useMutation(
    () => ({
      // Serialize updates: with whole-list team_views writes, concurrent
      // PUTs would clobber each other. Scoped mutations run one at a time,
      // and updater-style teamViews patches read the cache only once the
      // previous mutation's response has been written back.
      scope: { id: 'crm-team-settings' },
      mutationFn: async (patch: TeamCrmConfigPatch) => {
        const teamViews =
          typeof patch.teamViews === 'function'
            ? patch.teamViews(
                parseTeamViews(
                  queryClient.getQueryData<CrmTeamSettingsResponse>(
                    CRM_TEAM_SETTINGS_QUERY_KEY
                  )?.team_views
                )
              )
            : patch.teamViews;
        const body: UpdateCrmTeamSettingsRequest = {
          edit_stages_role: patch.permissions?.editStages,
          move_closed_deals_role: patch.permissions?.moveClosedDeals,
          delete_records_role: patch.permissions?.deleteRecords,
          ...(patch.closedStageIds !== undefined
            ? { closed_stage_ids: patch.closedStageIds }
            : {}),
          ...(teamViews !== undefined ? { team_views: teamViews } : {}),
          ...(patch.defaultTeamViewId !== undefined
            ? { default_team_view_id: patch.defaultTeamViewId }
            : {}),
        };
        return await throwOnErr(() => deps.storage.updateCrmTeamSettings(body));
      },
      onSuccess: (settings) => {
        // The PUT returns the resulting row — seed the cache with it.
        queryClient.setQueryData(CRM_TEAM_SETTINGS_QUERY_KEY, settings);
      },
      onSettled: () =>
        queryClient.invalidateQueries({
          queryKey: CRM_TEAM_SETTINGS_QUERY_KEY,
        }),
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
