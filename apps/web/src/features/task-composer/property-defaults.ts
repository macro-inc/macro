import { SYSTEM_PROPERTY_IDS } from '@property/identifiers';
import type { ComposeTaskProps } from './core/types';

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

/** Source is selectable, but its originating item is never a reusable default. */
export const TASK_TEMPLATE_CONTEXTUAL_PROPERTY_IDS: ReadonlySet<string> =
  new Set([SYSTEM_PROPERTY_IDS.SOURCE]);

/** Preserve launch-context values when a template starts the next task. */
export function templateContextualIds(
  props: ComposeTaskProps
): ReadonlySet<string> {
  return new Set([
    ...TASK_TEMPLATE_CONTEXTUAL_PROPERTY_IDS,
    ...Object.keys(props.composerContext?.initialPropertyValues ?? {}),
    ...(props.initialAssigneeIds?.length
      ? [SYSTEM_PROPERTY_IDS.ASSIGNEES]
      : []),
    ...(props.initialProjectId ? [SYSTEM_PROPERTY_IDS.PROJECT] : []),
    ...(props.initialDueDate ? [SYSTEM_PROPERTY_IDS.DUE_DATE] : []),
  ]);
}
