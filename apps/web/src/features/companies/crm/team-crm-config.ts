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

import { useUserId } from '@core/context/user';
import { throwOnErr } from '@core/util/result';
import { useCurrentTeamQuery, useIsTeamAdmin } from '@queries/team/teams';
import { TeamRole } from '@service-auth/generated/schemas/teamRole';
import { storageServiceClient } from '@service-storage/client';
import type { CrmTeamSettingsResponse } from '@service-storage/generated/schemas/crmTeamSettingsResponse';
import type { UpdateCrmTeamSettingsRequest } from '@service-storage/generated/schemas/updateCrmTeamSettingsRequest';
import { useMutation, useQuery, useQueryClient } from '@tanstack/solid-query';
import { type Accessor, createMemo } from 'solid-js';

const CRM_TEAM_SETTINGS_QUERY_KEY = ['crm', 'team-settings'] as const;

/**
 * Minimum team role required for a CRM capability. Team members are
 * view-only at the platform level (the backend maps member → View access
 * on companies), so the configurable range is admin (default) vs owner.
 */
export type CrmPermissionRole = 'admin' | 'owner';

export type CrmPermissions = {
  /** Who can change the deal stage set in CRM settings. */
  editStages: CrmPermissionRole;
  /** Who can move deals out of a closed stage. */
  moveClosedDeals: CrmPermissionRole;
  /** Who can delete (hide) CRM records. */
  deleteRecords: CrmPermissionRole;
};

export type TeamCrmSavedView = {
  id: string;
  name: string;
  /** Serialized CRM view state (see crm/saved-views). */
  config: unknown;
  createdBy?: string;
  createdAt?: string;
};

export type TeamCrmConfig = {
  permissions?: CrmPermissions;
  /**
   * Stage option ids that count as "closed" deals (used by the
   * move-closed-deals permission). When unset, stages labeled like
   * closed/won/lost states are treated as closed.
   */
  closedStageIds?: string[];
  teamViews?: TeamCrmSavedView[];
  /** Team view applied by default when a member opens the Customers view. */
  defaultTeamViewId?: string;
};

/**
 * Field-wise partial update of the shared config. Omitted fields keep
 * their current values; `null` clears `closedStageIds` /
 * `defaultTeamViewId`; `teamViews` replaces the whole list. Pass a
 * function for `teamViews` to derive the new list from the latest
 * cached value at execution time — mutations are serialized (shared
 * scope), so queued updates see the previous write instead of a stale
 * snapshot.
 */
export type TeamCrmConfigPatch = {
  permissions?: Partial<CrmPermissions>;
  closedStageIds?: string[] | null;
  teamViews?:
    | TeamCrmSavedView[]
    | ((current: TeamCrmSavedView[]) => TeamCrmSavedView[]);
  defaultTeamViewId?: string | null;
};

export const DEFAULT_CRM_PERMISSIONS: CrmPermissions = {
  editStages: 'admin',
  moveClosedDeals: 'admin',
  deleteRecords: 'admin',
};

/** Labels treated as closed when no explicit closed set is configured. */
const DEFAULT_CLOSED_STAGE_LABEL = /customer|churned|closed|won|lost/i;

export function useTeamCrmConfig() {
  const queryClient = useQueryClient();

  const settingsQuery = useQuery(() => ({
    queryKey: CRM_TEAM_SETTINGS_QUERY_KEY,
    queryFn: async () =>
      await throwOnErr(() => storageServiceClient.getCrmTeamSettings()),
  }));

  const config = createMemo((): TeamCrmConfig => {
    const data = settingsQuery.data;
    if (!data) return {};
    return {
      permissions: {
        editStages: data.edit_stages_role,
        moveClosedDeals: data.move_closed_deals_role,
        deleteRecords: data.delete_records_role,
      },
      closedStageIds: data.closed_stage_ids ?? undefined,
      teamViews: (data.team_views as TeamCrmSavedView[]) ?? [],
      defaultTeamViewId: data.default_team_view_id ?? undefined,
    };
  });

  const updateMutation = useMutation(() => ({
    // Serialize updates: with whole-list team_views writes, concurrent
    // PUTs would clobber each other. Scoped mutations run one at a time,
    // and updater-style teamViews patches read the cache only once the
    // previous mutation's response has been written back.
    scope: { id: 'crm-team-settings' },
    mutationFn: async (patch: TeamCrmConfigPatch) => {
      const teamViews =
        typeof patch.teamViews === 'function'
          ? patch.teamViews(
              (queryClient.getQueryData<CrmTeamSettingsResponse>(
                CRM_TEAM_SETTINGS_QUERY_KEY
              )?.team_views as TeamCrmSavedView[]) ?? []
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
      return await throwOnErr(() =>
        storageServiceClient.updateCrmTeamSettings(body)
      );
    },
    onSuccess: (settings) => {
      // The PUT returns the resulting row — seed the cache with it.
      queryClient.setQueryData(CRM_TEAM_SETTINGS_QUERY_KEY, settings);
    },
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: CRM_TEAM_SETTINGS_QUERY_KEY }),
  }));

  return {
    config,
    isLoading: () => settingsQuery.isLoading,
    update: updateMutation,
  };
}

/** Whether `role` satisfies a required minimum capability role. */
function roleSatisfies(
  role: TeamRole | undefined,
  required: CrmPermissionRole
): boolean {
  if (role === TeamRole.owner) return true;
  if (role === TeamRole.admin) return required === 'admin';
  return false;
}

/**
 * Effective CRM capabilities for the current user, combining the team's
 * configured permission thresholds with the platform-level rule that only
 * admins/owners can edit CRM data at all.
 */
export function useCrmPermissions() {
  const userId = useUserId();
  const teamQuery = useCurrentTeamQuery();
  const isTeamAdmin = useIsTeamAdmin();
  const { config, isLoading } = useTeamCrmConfig();

  const role = createMemo((): TeamRole | undefined => {
    const uid = userId();
    const team = teamQuery.data;
    if (!uid || !team) return undefined;
    return team.members.find((member) => member.user_id === uid)?.role;
  });

  const permissions = createMemo(
    (): CrmPermissions => ({
      ...DEFAULT_CRM_PERMISSIONS,
      ...config().permissions,
    })
  );

  return {
    role,
    permissions,
    isLoading,
    /** Can edit CRM data at all (platform rule: admin/owner). */
    canEditCrm: isTeamAdmin,
    canEditStages: createMemo(() =>
      roleSatisfies(role(), permissions().editStages)
    ),
    canMoveClosedDeals: createMemo(() =>
      roleSatisfies(role(), permissions().moveClosedDeals)
    ),
    canDeleteRecords: createMemo(() =>
      roleSatisfies(role(), permissions().deleteRecords)
    ),
  };
}

/**
 * True once the current-team query resolves to no team (null) or a team
 * with CRM disabled — the companies views swap in an explanatory empty
 * state and keep bottom chrome like the AI bar. Stays false while the
 * query loads so enabled teams don't flash the empty state.
 */
export function useCrmUnavailable(): Accessor<boolean> {
  const teamQuery = useCurrentTeamQuery();
  return () =>
    teamQuery.data === null || teamQuery.data?.team.crm_enabled === false;
}

/**
 * The set of stage option ids considered "closed" — explicit config when
 * present, else a label heuristic over the active stages.
 */
export function useClosedStageIds(
  stages: Accessor<Array<{ id: string; label: string }>>
): Accessor<Set<string>> {
  const { config } = useTeamCrmConfig();
  return createMemo(() => {
    const explicit = config().closedStageIds;
    if (explicit && explicit.length > 0) return new Set(explicit);
    return new Set(
      stages()
        .filter((stage) => DEFAULT_CLOSED_STAGE_LABEL.test(stage.label))
        .map((stage) => stage.id)
    );
  });
}
