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
   * closed/won/lost states are treated as closed; an empty list means
   * none are.
   */
  closedStageIds?: string[];
  /** System stage option id to team stage option id for seeded stages. */
  legacyStageIds?: Record<string, string>;
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

export type CrmTeamRole = 'owner' | 'admin' | 'member';

export function roleSatisfies(
  role: CrmTeamRole | undefined,
  required: CrmPermissionRole
): boolean {
  if (role === 'owner') return true;
  return role === 'admin' && required === 'admin';
}

export function closedStageIds(
  stages: readonly { id: string; label: string }[],
  explicit?: readonly string[]
): Set<string> {
  return new Set(
    explicit ??
      stages
        .filter((stage) => DEFAULT_CLOSED_STAGE_LABEL.test(stage.label))
        .map((stage) => stage.id)
  );
}
