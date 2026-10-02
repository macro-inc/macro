import { resolveCompanyStage } from '../core/stages';
/**
 * Team-customizable deal stages for the CRM.
 *
 * The builtin Stage property is a system definition whose options cannot be
 * modified through the API, so team customization works by giving the team
 * its own team-scoped `Deal Stage` property definition, written only through
 * `PUT /crm/stages` from CRM settings. When that definition exists, every
 * stage surface (kanban columns, list cells, filters, grouping, the company
 * panel) reads and writes it instead of the system property; otherwise the
 * seeded system stages apply. `useDealStages` is the single source of truth
 * for which set is active.
 */

// Import concrete entity helpers to keep stage sources independent of
// the entity barrel's UI initialization.
import { soupPropertyToProperty } from '@entity/extractors-property/property-helpers';
import { getCompanyStageOptionId } from '@entity/utils/company-properties';
import {
  ALL_COMPANY_STAGE_OPTIONS,
  COMPANY_STAGE_OPTIONS,
  getPropertyOptionLabel,
} from '@entity/utils/task-properties';
import {
  CRM_TEAM_STAGE_DEFINITION_NAME,
  SYSTEM_PROPERTY_IDS,
} from '@property/constants';
import type { Property } from '@property/types';
import type { PropertyDefinitionResponse } from '@service-properties/generated/schemas/propertyDefinitionResponse';
import type { PropertyDefinitionWithOptions } from '@service-properties/generated/schemas/propertyDefinitionWithOptions';
import type { PropertyOption } from '@service-properties/generated/schemas/propertyOption';
import { createLazyMemo } from '@solid-primitives/memo';
import type { CrmQuery, TeamConfigSource } from '../context/crm-sources';

// Canonical home is `@property/constants` (property pickers filter on it);
// re-exported here for the CRM-side callers.
export { CRM_TEAM_STAGE_DEFINITION_NAME } from '@property/constants';

import type { DealStage, DealStages } from '../context/crm-sources';

export type { DealStage, DealStages } from '../context/crm-sources';

/** Minimal company shape needed to read stage values. */
type CompanyLike = {
  properties?: Array<{
    definition: { id: string };
    value?: unknown;
  }> | null;
};

const DEFAULT_STAGES: DealStage[] = COMPANY_STAGE_OPTIONS.map((option) => ({
  id: option.value as string,
  label: option.label,
}));

// The filterable set on the system default: every system stage, in
// canonical pipeline order (legacy stages included).
const ALL_SYSTEM_STAGES: DealStage[] = ALL_COMPANY_STAGE_OPTIONS.map(
  (option) => ({
    id: option.value as string,
    label: option.label,
  })
);

function optionLabel(option: PropertyOption): string {
  const value = option.value;
  if (
    value &&
    typeof value === 'object' &&
    'value' in value &&
    typeof value.value === 'string'
  ) {
    return value.value;
  }
  return '';
}

function hasOptions(
  definition: PropertyDefinitionResponse
): definition is PropertyDefinitionWithOptions {
  return (
    'definition' in definition && Array.isArray(definition.property_options)
  );
}

/** Read the first select-option id stored for a definition on a company. */
export function getCompanySelectOptionId(
  entity: CompanyLike,
  definitionId: string
): string | undefined {
  const property = entity.properties?.find(
    (p) => p.definition.id === definitionId
  );
  const value = property?.value;
  if (
    !value ||
    typeof value !== 'object' ||
    !('type' in value) ||
    value.type !== 'SelectOption' ||
    !('value' in value) ||
    !Array.isArray(value.value)
  ) {
    return undefined;
  }
  const optionId = value.value[0];
  return typeof optionId === 'string' ? optionId : undefined;
}

/**
 * Find the team's stage definition (with options) in a team-scope
 * definitions listing, if the team has customized stages.
 */
export function findTeamStageDefinition(
  definitions: PropertyDefinitionResponse[] | undefined
): PropertyDefinitionWithOptions | undefined {
  return definitions?.find(
    (entry): entry is PropertyDefinitionWithOptions =>
      hasOptions(entry) &&
      entry.definition.display_name === CRM_TEAM_STAGE_DEFINITION_NAME &&
      entry.definition.data_type === 'SELECT_STRING' &&
      !entry.definition.is_system &&
      entry.definition.owner.scope === 'team'
  );
}

/** Stages (ordered) from a team stage definition's options. */
export function stagesFromDefinition(
  definition: PropertyDefinitionWithOptions
): DealStage[] {
  return [...definition.property_options]
    .sort((a, b) => a.display_order - b.display_order)
    .map((option) => ({ id: option.id, label: optionLabel(option) }))
    .filter((stage) => stage.label !== '');
}

function buildStagePropertyStub(
  definition: PropertyDefinitionWithOptions | undefined
): Property {
  if (!definition) {
    // System default — same stub the CRM list/kanban always used.
    return soupPropertyToProperty({
      id: SYSTEM_PROPERTY_IDS.STAGE,
      definition: {
        id: SYSTEM_PROPERTY_IDS.STAGE,
        display_name: 'Stage',
        data_type: 'SELECT_STRING',
        is_metadata: false,
        is_multi_select: false,
        is_system: true,
        owner: { scope: 'system' },
        specific_entity_type: null,
        created_at: new Date(0).toISOString(),
        updated_at: new Date(0).toISOString(),
      },
    });
  }
  const property = soupPropertyToProperty({
    id: definition.definition.id,
    definition: {
      id: definition.definition.id,
      display_name: definition.definition.display_name,
      data_type: 'SELECT_STRING',
      is_metadata: false,
      is_multi_select: false,
      is_system: false,
      owner: definition.definition.owner,
      specific_entity_type: null,
      created_at: definition.definition.created_at,
      updated_at: definition.definition.updated_at,
    },
  });
  return { ...property, options: definition.property_options };
}

/**
 * The active deal-stage set for the current team. See module docs for the
 * system-vs-team resolution rules.
 */
export function useDealStages(
  teamDefinitionsQuery: CrmQuery<PropertyDefinitionResponse[]>,
  teamCrmConfig: TeamConfigSource
): DealStages {
  // Read metadata when a stage consumer needs it. Keep pending metadata
  // within the existing Suspense boundary instead of showing default stages.
  const teamStageDefinition = createLazyMemo(() =>
    findTeamStageDefinition(teamDefinitionsQuery.data)
  );

  // Customized only once the team set actually has stages; an empty custom
  // set keeps the system defaults active (see stages() below).
  const isCustomized = createLazyMemo(() => {
    const definition = teamStageDefinition();
    return !!definition && stagesFromDefinition(definition).length > 0;
  });

  const stages = createLazyMemo((): DealStage[] => {
    const definition = teamStageDefinition();
    if (!definition) return DEFAULT_STAGES;
    const customStages = stagesFromDefinition(definition);
    // An empty custom set would render an unusable board — treat it as
    // not-yet-populated and keep the defaults.
    return customStages.length > 0 ? customStages : DEFAULT_STAGES;
  });

  const filterStages = createLazyMemo((): DealStage[] =>
    isCustomized() ? stages() : ALL_SYSTEM_STAGES
  );

  const stageDefinitionId = createLazyMemo(() => {
    const definition = teamStageDefinition();
    return definition && stagesFromDefinition(definition).length > 0
      ? definition.definition.id
      : SYSTEM_PROPERTY_IDS.STAGE;
  });

  const stageProperty = createLazyMemo(() => {
    const definition = teamStageDefinition();
    return buildStagePropertyStub(
      definition && stagesFromDefinition(definition).length > 0
        ? definition
        : undefined
    );
  });

  const stageIds = createLazyMemo(() => new Set(stages().map((s) => s.id)));

  const labelById = createLazyMemo(() => {
    const map = new Map<string, string>();
    for (const stage of stages()) map.set(stage.id, stage.label);
    return map;
  });

  const resolveStage = (entity: CompanyLike): string | undefined => {
    const direct = getCompanySelectOptionId(entity, stageDefinitionId());
    if (direct && stageIds().has(direct)) return direct;
    if (stageDefinitionId() === SYSTEM_PROPERTY_IDS.STAGE) return direct;
    return resolveCompanyStage({
      direct,
      customized: stageDefinitionId() !== SYSTEM_PROPERTY_IDS.STAGE,
      stages: stages(),
      legacy: getCompanyStageOptionId(
        entity as Parameters<typeof getCompanyStageOptionId>[0]
      ),
      legacyMapping: teamCrmConfig.config().legacyStageIds,
      legacyLabel: getPropertyOptionLabel,
    });
  };

  const stageLabel = (optionId: string): string | undefined =>
    labelById().get(optionId) ?? getPropertyOptionLabel(optionId);

  return {
    stages,
    filterStages,
    isCustomized,
    stageDefinitionId,
    stageProperty,
    resolveStage,
    stageLabel,
    isLoading: () =>
      teamDefinitionsQuery.isPending || teamCrmConfig.isLoading(),
    isError: () =>
      teamDefinitionsQuery.isError && teamDefinitionsQuery.data === undefined,
  };
}
