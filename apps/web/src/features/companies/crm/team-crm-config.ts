/**
 * Team-shared CRM configuration (permissions, closed-stage set, team saved
 * views, display defaults).
 *
 * There is no generic team key-value store yet, so the config rides on the
 * existing team-scoped property-definition infrastructure: a reserved
 * definition (`__macro:crm-config`) holds a single select option whose
 * string value is the JSON config. Every team member can read it (team
 * definitions are team-visible) and writes go through the existing option
 * endpoints. Reserved `__macro:`-prefixed definitions are filtered out of
 * property pickers (see `isReservedPropertyDefinitionName`).
 */

import { useUserId } from '@core/context/user';
import { throwOnErr } from '@core/util/result';
import { RESERVED_PROPERTY_DEFINITION_PREFIX } from '@property/constants';
import { useListPropertiesQuery } from '@queries/properties/definitions';
import { useCurrentTeamQuery, useIsTeamAdmin } from '@queries/team/teams';
import { TeamRole } from '@service-auth/generated/schemas/teamRole';
import { propertiesServiceClient } from '@service-properties/client';
import type { PropertyDefinitionResponse } from '@service-properties/generated/schemas/propertyDefinitionResponse';
import type { PropertyDefinitionWithOptions } from '@service-properties/generated/schemas/propertyDefinitionWithOptions';
import { useMutation, useQueryClient } from '@tanstack/solid-query';
import { type Accessor, createMemo } from 'solid-js';

// Canonical home is `@property/constants`; re-exported for existing callers.
export {
  isReservedPropertyDefinitionName,
  RESERVED_PROPERTY_DEFINITION_PREFIX,
} from '@property/constants';

const CRM_CONFIG_DEFINITION_NAME = `${RESERVED_PROPERTY_DEFINITION_PREFIX}crm-config`;

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
  version: 1;
  permissions?: Partial<CrmPermissions>;
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

export const DEFAULT_CRM_PERMISSIONS: CrmPermissions = {
  editStages: 'admin',
  moveClosedDeals: 'admin',
  deleteRecords: 'admin',
};

/** Labels treated as closed when no explicit closed set is configured. */
const DEFAULT_CLOSED_STAGE_LABEL = /customer|churned|closed|won|lost/i;

function findConfigDefinition(
  definitions: PropertyDefinitionResponse[] | undefined
): PropertyDefinitionWithOptions | undefined {
  return definitions?.find(
    (entry): entry is PropertyDefinitionWithOptions =>
      'definition' in entry &&
      entry.definition.display_name === CRM_CONFIG_DEFINITION_NAME &&
      !entry.definition.is_system &&
      entry.definition.owner.scope === 'team'
  );
}

function parseConfig(definition: PropertyDefinitionWithOptions | undefined): {
  config: TeamCrmConfig;
  optionId?: string;
} {
  const empty: TeamCrmConfig = { version: 1 };
  if (!definition) return { config: empty };
  const option = [...definition.property_options].sort(
    (a, b) => a.display_order - b.display_order
  )[0];
  const raw = option?.value;
  if (
    !raw ||
    typeof raw !== 'object' ||
    !('value' in raw) ||
    typeof raw.value !== 'string'
  ) {
    return { config: empty, optionId: option?.id };
  }
  try {
    const parsed = JSON.parse(raw.value) as TeamCrmConfig;
    return { config: { ...empty, ...parsed }, optionId: option?.id };
  } catch {
    return { config: empty, optionId: option?.id };
  }
}

export function useTeamCrmConfig() {
  const queryClient = useQueryClient();
  const teamDefinitionsQuery = useListPropertiesQuery(() => ({
    scope: 'team',
    includeOptions: true,
  }));

  const parsed = createMemo(() =>
    parseConfig(findConfigDefinition(teamDefinitionsQuery.data))
  );

  const config = createMemo(() => parsed().config);

  const invalidate = () =>
    queryClient.invalidateQueries({
      predicate: ({ queryKey }) =>
        queryKey.includes('properties') && queryKey.includes('definitions'),
    });

  /**
   * Read-modify-write of the shared config. Creates the reserved
   * definition/option on first write; concurrent writers are last-wins.
   */
  const updateMutation = useMutation(() => ({
    mutationFn: async (updater: (current: TeamCrmConfig) => TeamCrmConfig) => {
      // Re-list right before writing to reduce lost updates.
      const definitions = await throwOnErr(
        async () =>
          await propertiesServiceClient.listProperties({
            scope: 'team',
            include_options: true,
          })
      );
      const existing = findConfigDefinition(definitions);
      const definitionId = existing
        ? existing.definition.id
        : (
            await throwOnErr(
              async () =>
                await propertiesServiceClient.createPropertyDefinition({
                  body: {
                    display_name: CRM_CONFIG_DEFINITION_NAME,
                    data_type: {
                      type: 'select_string',
                      multi: false,
                      options: [],
                    },
                    scope: 'team',
                  },
                })
            )
          ).id;
      const { config: current, optionId } = parseConfig(existing);
      const next = updater(current);
      const serialized = JSON.stringify(next);
      if (optionId) {
        await throwOnErr(
          async () =>
            await propertiesServiceClient.updatePropertyOption({
              definition_id: definitionId,
              option_id: optionId,
              body: { value: serialized },
            })
        );
      } else {
        await throwOnErr(
          async () =>
            await propertiesServiceClient.addPropertyOption({
              definition_id: definitionId,
              body: {
                type: 'select_string',
                option: { value: serialized, display_order: 0 },
              },
            })
        );
      }
      return next;
    },
    onSettled: () => invalidate(),
  }));

  return {
    config,
    isLoading: () => teamDefinitionsQuery.isLoading,
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
