import {
  fillTaskTemplate,
  type TaskTemplateContents,
} from '@app/features/task-templates/core/template';
import type { PropertyApiValues } from '@property/types';

export type SavedTaskTemplate = {
  id: string;
  name: string;
  revision: number;
  teamId: string | null;
  contents: TaskTemplateContents;
};

export type TemplateCreationRequest = {
  creationId: string;
  name: string;
  teamId: string | null;
  contents: TaskTemplateContents;
};

export type TaskTemplateSelection =
  | { kind: 'none' }
  | { kind: 'new'; name: string; teamId: string | null; creationId: string }
  | { kind: 'editing'; template: SavedTaskTemplate; name: string }
  | { kind: 'saved'; template: SavedTaskTemplate };

/** A template editing session is persisted beside, never instead of, the task draft. */
export type TaskTemplateEditorDraft = {
  selection: Extract<TaskTemplateSelection, { kind: 'new' | 'editing' }>;
  contents: TaskTemplateContents;
  request?: TemplateCreationRequest;
};

export function templateSubmitKind(
  selection: TaskTemplateSelection
): 'task' | 'template' {
  return selection.kind === 'new' || selection.kind === 'editing'
    ? 'template'
    : 'task';
}

/** Build from the original task defaults, preserving only current contextual values when supplied. */
export function freshTaskFromTemplate(
  initial: TaskTemplateContents,
  template: TaskTemplateContents,
  available: ReadonlySet<string>,
  contextualIds: ReadonlySet<string>,
  currentValues?: Record<string, PropertyApiValues>
): TaskTemplateContents {
  const defaults = structuredClone(initial.propertyDefaults);
  if (currentValues) {
    for (const id of contextualIds) {
      if (id in currentValues)
        defaults[id] = structuredClone(currentValues[id]);
      else delete defaults[id];
    }
  }
  const templateDefaults = structuredClone(template.propertyDefaults);
  for (const id of template.propertyIds) {
    if (contextualIds.has(id)) delete templateDefaults[id];
    else delete defaults[id];
  }
  return fillTaskTemplate(
    { ...initial, propertyDefaults: defaults },
    { ...template, propertyDefaults: templateDefaults },
    available
  );
}
