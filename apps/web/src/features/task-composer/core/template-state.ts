import {
  captureTaskTemplate,
  TASK_TEMPLATE_CONTEXTUAL_PROPERTY_IDS,
  type TaskTemplateContents,
} from '@app/features/task-templates/core/template';
import { SYSTEM_PROPERTY_IDS } from '@property/constants';
import type { TaskTemplateSelection } from './template-selection';
import type { ComposeTaskProps } from './types';

/** Hidden sharing controls must not overwrite a saved template's default. */
export function taskTemplateSharing(
  current: boolean,
  selection: TaskTemplateSelection,
  hasTeam: boolean
): boolean | undefined {
  if (!hasTeam && (selection.kind === 'saved' || selection.kind === 'editing'))
    return selection.template.contents.shareWithTeam;
  return current;
}

/** Switching templates confirms changed task text, fields, or template metadata. */
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
    (current.title?.trim() || current.descriptionMarkdown.trim())
  )
    return true;
  if (!baseline) return true;
  if ((current.title ?? '') !== (baseline.title ?? '')) return true;
  if (current.shareWithTeam !== baseline.shareWithTeam) return true;
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

/** Description and title edits never mark reusable field defaults as changed. */
export function areTemplateFieldsDirty(
  current: TaskTemplateContents,
  baseline: TaskTemplateContents | undefined
): boolean {
  if (!baseline) return true;
  // Compare reusable fields only; task prose and contextual links are not template edits.
  const available = new Set([...current.propertyIds, ...baseline.propertyIds]);
  return isTemplateStateDirty(
    {
      ...captureTaskTemplate(current, available),
      title: '',
      propertyIds: current.propertyIds.filter(
        (id) => !TASK_TEMPLATE_CONTEXTUAL_PROPERTY_IDS.has(id)
      ),
      descriptionMarkdown: '',
    },
    {
      ...captureTaskTemplate(baseline, available),
      title: '',
      propertyIds: baseline.propertyIds.filter(
        (id) => !TASK_TEMPLATE_CONTEXTUAL_PROPERTY_IDS.has(id)
      ),
      descriptionMarkdown: '',
    }
  );
}
/** Reset reusable fields without discarding contextual Source or task text. */
export function restoreTemplateFields(
  current: TaskTemplateContents,
  baseline: TaskTemplateContents
): TaskTemplateContents {
  // Restore applied defaults without replacing the current task's origin link.
  const propertyDefaults = structuredClone(baseline.propertyDefaults);
  for (const id of TASK_TEMPLATE_CONTEXTUAL_PROPERTY_IDS) {
    const value = current.propertyDefaults[id];
    if (value) propertyDefaults[id] = structuredClone(value);
    else delete propertyDefaults[id];
  }
  return {
    ...current,
    shareWithTeam: baseline.shareWithTeam ?? current.shareWithTeam,
    propertyIds: [
      ...baseline.propertyIds.filter(
        (id) => !TASK_TEMPLATE_CONTEXTUAL_PROPERTY_IDS.has(id)
      ),
      ...current.propertyIds.filter((id) =>
        TASK_TEMPLATE_CONTEXTUAL_PROPERTY_IDS.has(id)
      ),
    ],
    propertyDefaults,
  };
}

/** Preserve values supplied by the launch context instead of template defaults. */
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
