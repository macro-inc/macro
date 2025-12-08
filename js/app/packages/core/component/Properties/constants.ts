/**
 * Business logic constants for Properties components
 * For styling constants, see styles/styles.ts (PROPERTY_STYLES)
 */

import type { BlockName } from '@core/block';

export const NUMBER_DECIMAL_PLACES = 4; // Matches backend precision

/**
 * System property definition IDs (from backend seed migration).
 * These are stable UUIDs that match the database.
 */
export const SYSTEM_PROPERTY_IDS = {
  // Task properties
  ASSIGNEES: '00000001-0000-0000-0000-000000000001',
  STATUS: '00000001-0000-0000-0000-000000000002',
  PRIORITY: '00000001-0000-0000-0000-000000000003',
  DUE_DATE: '00000001-0000-0000-0000-000000000004',
  PARENT_TASK: '00000001-0000-0000-0000-000000000005',
  SUBTASKS: '00000001-0000-0000-0000-000000000006',
  DEPENDS_ON: '00000001-0000-0000-0000-000000000007',
  EFFORT: '00000001-0000-0000-0000-000000000008',
  STORY_POINTS: '00000001-0000-0000-0000-000000000009',
  RELEVANT_DOCUMENTS: '00000001-0000-0000-0000-00000000000a',
  // Email attachment properties
  SOURCE: '00000001-0000-0000-0000-00000000000b',
  COMPANIES: '00000001-0000-0000-0000-00000000000c',
  SENDER: '00000001-0000-0000-0000-00000000000d',
  RECIPIENTS: '00000001-0000-0000-0000-00000000000e',
  SUBJECT: '00000001-0000-0000-0000-00000000000f',
} as const;

/**
 * Builtin property definition IDs by block type.
 * These properties are automatically attached to entities of this block type
 * and cannot be removed. Order matches backend (display order).
 */
export const BUILTIN_PROPERTIES_BY_BLOCK: Partial<
  Record<BlockName, readonly string[]>
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
} as const;

/**
 * Get the builtin property definition IDs for a block type.
 * Returns empty array if block has no builtin properties.
 */
export function getBuiltinPropertyIds(blockType: BlockName): readonly string[] {
  return BUILTIN_PROPERTIES_BY_BLOCK[blockType] ?? [];
}

export const FOCUS_CONFIG = {
  DELAY: 100, // Delay before focusing element after it's connected to DOM
} as const;

export const MODAL_DIMENSIONS = {
  DEFAULT_WIDTH: 448, // 28rem
  DEFAULT_HEIGHT: 384, // 24rem
  PROPERTY_EDITOR_HEIGHT: 384,
  SELECTOR_TOP_PERCENTAGE: 0.2, // 20% from top
  SELECTOR_MIN_TOP_MARGIN: 16, // 1rem
  SELECTOR_SMALL_SCREEN_THRESHOLD: 600, // Mobile breakpoint
  SELECTOR_SMALL_SCREEN_TOP_PERCENTAGE: 0.1, // 10% from top
} as const;
