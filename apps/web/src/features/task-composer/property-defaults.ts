import { SYSTEM_PROPERTY_IDS } from '@property/identifiers';

/** Default composer order; hosts append contextual properties to this list. */
export const DEFAULT_TASK_COMPOSER_PROPERTY_IDS = [
  SYSTEM_PROPERTY_IDS.STATUS,
  SYSTEM_PROPERTY_IDS.PRIORITY,
  SYSTEM_PROPERTY_IDS.ASSIGNEES,
  SYSTEM_PROPERTY_IDS.DUE_DATE,
  SYSTEM_PROPERTY_IDS.PROJECT,
];

/** Snapshot selected writable definitions alongside the task's default pins. */
export function initialTaskPinDefinitionIds(
  selectedIds: readonly string[],
  writableIds: ReadonlySet<string>,
  defaultIds: readonly string[]
): string[] {
  return [
    ...new Set([
      ...defaultIds,
      ...selectedIds.filter((id) => writableIds.has(id)),
    ]),
  ];
}
