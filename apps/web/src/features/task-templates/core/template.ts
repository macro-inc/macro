import { SYSTEM_PROPERTY_IDS } from '@property/identifiers';
import type { PropertyApiValues } from '../../property/types';

/** Editable template content, separate from persistence and ownership metadata. */
export type TaskTemplateContents = {
  title?: string;
  shareWithTeam?: boolean;
  propertyIds: string[];
  propertyDefaults: Record<string, PropertyApiValues>;
  descriptionMarkdown: string;
};

/** Keep the Source field reusable without copying a task's original item. */
export const TASK_TEMPLATE_CONTEXTUAL_PROPERTY_IDS: ReadonlySet<string> =
  new Set([SYSTEM_PROPERTY_IDS.SOURCE]);

/** Empty lists and text are blank; zero and false remain explicit values. */
export function hasTemplatePropertyValue(
  value: PropertyApiValues | undefined
): value is PropertyApiValues {
  if (!value) return false;
  if ('refs' in value) return Boolean(value.refs?.length);
  if ('values' in value) return Boolean(value.values?.length);
  if (!('value' in value)) return false;
  const current = value.value;
  if (typeof current === 'string') return current.trim().length > 0;
  if (typeof current === 'number') return Number.isFinite(current);
  if (current instanceof Date) return Number.isFinite(current.getTime());
  return current !== null && current !== undefined;
}

/** Add available template fields without replacing existing input or context. */
export function fillTaskTemplate(
  current: TaskTemplateContents,
  template: TaskTemplateContents,
  availablePropertyIds: ReadonlySet<string>
): TaskTemplateContents {
  const propertyIds = template.propertyIds.filter((id) =>
    availablePropertyIds.has(id)
  );
  const propertyDefaults = structuredClone(current.propertyDefaults);
  for (const id of propertyIds) {
    const value = template.propertyDefaults[id];
    if (
      hasTemplatePropertyValue(value) &&
      !hasTemplatePropertyValue(propertyDefaults[id])
    ) {
      propertyDefaults[id] = structuredClone(value);
    }
  }
  return {
    title: current.title?.trim() ? current.title : template.title,
    shareWithTeam: template.shareWithTeam ?? current.shareWithTeam,
    propertyIds: [...new Set([...current.propertyIds, ...propertyIds])],
    propertyDefaults,
    descriptionMarkdown: current.descriptionMarkdown.trim()
      ? current.descriptionMarkdown
      : template.descriptionMarkdown,
  };
}

/** Capture selected fields while excluding contextual values from reusable defaults. */
export function captureTaskTemplate(
  current: TaskTemplateContents,
  availablePropertyIds: ReadonlySet<string>
): TaskTemplateContents {
  const propertyIds = [...new Set(current.propertyIds)].filter((id) =>
    availablePropertyIds.has(id)
  );
  const propertyDefaults: Record<string, PropertyApiValues> = {};
  for (const id of propertyIds) {
    const value = current.propertyDefaults[id];
    if (
      !TASK_TEMPLATE_CONTEXTUAL_PROPERTY_IDS.has(id) &&
      hasTemplatePropertyValue(value)
    ) {
      propertyDefaults[id] = structuredClone(value);
    }
  }
  return {
    title: current.title,
    shareWithTeam: current.shareWithTeam,
    propertyIds,
    propertyDefaults,
    descriptionMarkdown: current.descriptionMarkdown,
  };
}
