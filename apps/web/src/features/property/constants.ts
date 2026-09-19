/**
 * Business logic constants for Properties components
 * For styling constants, see styles/styles.ts (PROPERTY_STYLES)
 */

import type { BlockAlias, BlockName } from '@core/block';
import { SYSTEM_PROPERTY_IDS } from './identifiers';

export { PROPERTY_OPTION_IDS, SYSTEM_PROPERTY_IDS } from './identifiers';

export const NUMBER_DECIMAL_PLACES = 4;

/**
 * Reserved display name of the team-scoped CRM deal-stage definition
 * (unique per team). Managed exclusively from CRM settings, so generic
 * property pickers must not offer it.
 */
export const CRM_TEAM_STAGE_DEFINITION_NAME = 'Deal Stage';

/**
 * Builtin property definition IDs by block type.
 * These properties are automatically attached to entities of this block type
 * and cannot be removed. Order matches backend (display order).
 */
const BUILTIN_PROPERTIES_BY_BLOCK: Partial<
  Record<BlockName | BlockAlias, readonly string[]>
> = {
  task: [
    SYSTEM_PROPERTY_IDS.ASSIGNEES,
    SYSTEM_PROPERTY_IDS.STATUS,
    SYSTEM_PROPERTY_IDS.PRIORITY,
    SYSTEM_PROPERTY_IDS.DUE_DATE,
    SYSTEM_PROPERTY_IDS.PARENT_TASK,
    SYSTEM_PROPERTY_IDS.SUBTASKS,
    SYSTEM_PROPERTY_IDS.DEPENDS_ON,
    SYSTEM_PROPERTY_IDS.EFFORT,
    SYSTEM_PROPERTY_IDS.STORY_POINTS,
    SYSTEM_PROPERTY_IDS.RELEVANT_DOCUMENTS,
  ],
  company: [
    SYSTEM_PROPERTY_IDS.STAGE,
    SYSTEM_PROPERTY_IDS.COMPANY_OWNER,
    SYSTEM_PROPERTY_IDS.REVENUE,
  ],
} as const;

/**
 * Default pinned properties by block type.
 * These are automatically pinned when a new entity of this block type is created.
 */
const DEFAULT_PINNED_PROPERTIES_BY_BLOCK: Partial<
  Record<BlockName | BlockAlias, readonly string[]>
> = {
  task: [
    SYSTEM_PROPERTY_IDS.STATUS,
    SYSTEM_PROPERTY_IDS.PRIORITY,
    SYSTEM_PROPERTY_IDS.ASSIGNEES,
  ],
  company: [
    SYSTEM_PROPERTY_IDS.STAGE,
    SYSTEM_PROPERTY_IDS.COMPANY_OWNER,
    SYSTEM_PROPERTY_IDS.REVENUE,
  ],
} as const;

/**
 * Get the default pinned property definition IDs for a block type.
 * Returns empty array if block has no default pinned properties.
 */
export function getDefaultPinnedProperties(
  blockType: BlockName | BlockAlias
): readonly string[] {
  return DEFAULT_PINNED_PROPERTIES_BY_BLOCK[blockType] ?? [];
}

/**
 * Get the builtin property definition IDs for a block type.
 * Returns empty array if block has no builtin properties.
 */
export function getBuiltinPropertyIds(
  blockType: BlockName | BlockAlias
): readonly string[] {
  return BUILTIN_PROPERTIES_BY_BLOCK[blockType] ?? [];
}

export const FOCUS_CONFIG = {
  DELAY: 100,
} as const;
