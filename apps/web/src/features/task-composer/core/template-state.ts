import {
  captureTaskTemplate,
  type TaskTemplateContents,
} from '@app/features/task-templates/core/template';
import { SYSTEM_PROPERTY_IDS } from '@property/constants';
import type { TaskTemplateSelection } from './template-selection';
import type { ComposeTaskProps } from './types';

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
  const available = new Set([...current.propertyIds, ...baseline.propertyIds]);
  const excluded = new Set([SYSTEM_PROPERTY_IDS.SOURCE]);
  return isTemplateStateDirty(
    {
      ...captureTaskTemplate(current, available, excluded),
      title: '',
      propertyIds: current.propertyIds.filter(
        (id) => id !== SYSTEM_PROPERTY_IDS.SOURCE
      ),
      descriptionMarkdown: '',
    },
    {
      ...captureTaskTemplate(baseline, available, excluded),
      title: '',
      propertyIds: baseline.propertyIds.filter(
        (id) => id !== SYSTEM_PROPERTY_IDS.SOURCE
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
  const propertyDefaults = structuredClone(baseline.propertyDefaults);
  const source = current.propertyDefaults[SYSTEM_PROPERTY_IDS.SOURCE];
  if (source)
    propertyDefaults[SYSTEM_PROPERTY_IDS.SOURCE] = structuredClone(source);
  else delete propertyDefaults[SYSTEM_PROPERTY_IDS.SOURCE];
  return {
    ...current,
    propertyIds: [
      ...baseline.propertyIds.filter((id) => id !== SYSTEM_PROPERTY_IDS.SOURCE),
      ...current.propertyIds.filter((id) => id === SYSTEM_PROPERTY_IDS.SOURCE),
    ],
    propertyDefaults,
  };
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
