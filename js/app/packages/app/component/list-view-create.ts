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
  | 'doc'
  | 'email'
  | 'folder'
  | 'message'
  | 'task';

export function getListViewCreateActionId(
  view: ListView
): ListViewCreateActionId | undefined {
  return LIST_VIEW_CREATE_ACTIONS[view];
}
