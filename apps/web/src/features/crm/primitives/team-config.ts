import { type Accessor, createMemo } from 'solid-js';
import type { TeamConfigSource, TeamSource } from '../context/crm-sources';
import {
  type CrmPermissions,
  type CrmTeamRole,
  closedStageIds,
  DEFAULT_CRM_PERMISSIONS,
  roleSatisfies,
} from '../core/team-config';
/**
 * Effective CRM capabilities for the current user, combining the team's
 * configured permission thresholds with the platform-level rule that any
 * team member can edit CRM data (governance actions stay admin/owner).
 */
export function createCrmPermissions(
  userId: Accessor<string | undefined>,
  teamQuery: TeamSource,
  settings: TeamConfigSource
) {
  const { config, isLoading } = settings;

  const role = createMemo((): CrmTeamRole | undefined => {
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
    /** Can edit CRM data at all (platform rule: any team member). */
    canEditCrm: () => role() !== undefined,
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
 * The set of stage option ids considered "closed" — explicit config when
 * present, else a label heuristic over the active stages.
 */
export function createClosedStageIds(
  settings: TeamConfigSource,
  stages: Accessor<Array<{ id: string; label: string }>>
): Accessor<Set<string>> {
  const { config } = settings;
  return createMemo(() => closedStageIds(stages(), config().closedStageIds));
}
