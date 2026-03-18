import type { ListView } from '@app/constants/list-views';

export const LIST_VIEW_CREATE_ACTIONS: Partial<
  Record<ListView, ListViewCreateActionId>
> = {
  agents: 'agent',
  mail: 'email',
  documents: 'doc',
  tasks: 'task',
  channels: 'message',
  files: 'folder',
};

export type ListViewCreateActionId =
  | 'agent'
  | 'canvas'
  | 'doc'
  | 'email'
  | 'folder'
  | 'message'
  | 'task';

export type ListViewCreateOptionId = ListViewCreateActionId | 'import';

const CREATE_OPTION_LABELS: Record<ListViewCreateOptionId, string> = {
  agent: 'agent',
  canvas: 'canvas',
  doc: 'doc',
  email: 'email',
  folder: 'folder',
  import: 'Import',
  message: 'message',
  task: 'task',
};

export type ListViewCreateOption = {
  id: ListViewCreateOptionId;
  label: string;
};

export function getListViewCreateActionId(
  view: ListView
): ListViewCreateActionId | undefined {
  return LIST_VIEW_CREATE_ACTIONS[view];
}

export function getCreateActionLabel(actionId: ListViewCreateActionId): string {
  return CREATE_OPTION_LABELS[actionId];
}

export function getListViewCreateButtonLabel(
  view: ListView
): string | undefined {
  const actionId = getListViewCreateActionId(view);
  if (!actionId) return;
  return `New ${getCreateActionLabel(actionId)}`;
}

export function getCreateOptionLabel(optionId: ListViewCreateOptionId): string {
  return CREATE_OPTION_LABELS[optionId];
}

export function getListViewCreateOptions(
  view: ListView
): ListViewCreateOption[] {
  if (view === 'documents') {
    return [
      { id: 'doc', label: 'New doc' },
      { id: 'canvas', label: 'New canvas' },
      { id: 'import', label: 'Import' },
    ];
  }

  const actionId = getListViewCreateActionId(view);
  if (!actionId) return [];

  return [{ id: actionId, label: `New ${getCreateOptionLabel(actionId)}` }];
}
