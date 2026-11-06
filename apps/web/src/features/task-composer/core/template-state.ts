import type { TaskTemplateContents } from '@app/features/task-templates/core/template';
import { SYSTEM_PROPERTY_IDS } from '@property/constants';
import type { TaskTemplateSelection } from './template-selection';
import type { ComposeTaskProps } from './types';

/** Template edits include metadata and baseline differences, but never the task title. */
export function isTemplateStateDirty(
  current: TaskTemplateContents,
  baseline: TaskTemplateContents | undefined,
  selection?: TaskTemplateSelection
): boolean {
  if (
    (selection?.kind === 'new' &&
      Boolean(selection.name || selection.teamId)) ||
    (selection?.kind === 'editing' &&
      selection.name !== selection.template.name)
  )
    return true;
  // Existing task text is not disposable template content, even when prefilled.
  if (
    (selection?.kind === 'none' || selection?.kind === 'new') &&
    current.descriptionMarkdown.trim()
  )
    return true;
  if (!baseline) return true;
  if (
    JSON.stringify(current.propertyIds) !== JSON.stringify(baseline.propertyIds)
  )
    return true;
  if (current.descriptionMarkdown !== baseline.descriptionMarkdown) return true;

  const currentIds = Object.keys(current.propertyDefaults).sort();
  const baselineIds = Object.keys(baseline.propertyDefaults).sort();
  if (JSON.stringify(currentIds) !== JSON.stringify(baselineIds)) return true;
  return currentIds.some(
    (id) =>
      JSON.stringify(current.propertyDefaults[id]) !==
      JSON.stringify(baseline.propertyDefaults[id])
  );
}

/** Preserve values supplied by the launch context instead of template defaults. */
export function templateContextualIds(
  props: ComposeTaskProps
): ReadonlySet<string> {
  return new Set([
    SYSTEM_PROPERTY_IDS.SOURCE,
    ...Object.keys(props.composerContext?.initialPropertyValues ?? {}),
    ...(props.initialAssigneeIds?.length
      ? [SYSTEM_PROPERTY_IDS.ASSIGNEES]
      : []),
    ...(props.initialProjectId ? [SYSTEM_PROPERTY_IDS.PROJECT] : []),
    ...(props.initialDueDate ? [SYSTEM_PROPERTY_IDS.DUE_DATE] : []),
  ]);
}
