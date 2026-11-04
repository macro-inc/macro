import {
  fillTaskTemplate,
  type TaskTemplateContents,
} from '@app/features/task-templates/core/template';

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

export function templateSubmitKind(
  selection: TaskTemplateSelection,
  title: string
): 'task' | 'template' | 'task-and-template' {
  if (selection.kind === 'editing') return 'template';
  if (selection.kind !== 'new') return 'task';
  return title.trim() ? 'task-and-template' : 'template';
}

/** Build another task from the preset, not from the task just submitted. */
export function freshTaskFromTemplate(
  initial: TaskTemplateContents,
  template: TaskTemplateContents,
  available: ReadonlySet<string>,
  contextualIds: ReadonlySet<string>
): TaskTemplateContents {
  const defaults = structuredClone(initial.propertyDefaults);
  for (const id of template.propertyIds) {
    if (!contextualIds.has(id)) delete defaults[id];
  }
  return fillTaskTemplate(
    { ...initial, propertyDefaults: defaults },
    template,
    available
  );
}
