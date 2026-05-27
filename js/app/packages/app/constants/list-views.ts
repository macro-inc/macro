import type { BlockAlias, BlockName } from '@core/block';
import type { SoupApiItem } from '@service-storage/generated/schemas';

export const LIST_VIEWS = [
  'inbox',
  'agents',
  'mail',
  'documents',
  'tasks',
  'channels',
  'calls',
  'folders',
  'search',
] as const;

export type ListView = (typeof LIST_VIEWS)[number];

export const LIST_VIEW_PATHS = {
  inbox: '/inbox',
  agents: '/agents',
  mail: '/mail',
  documents: '/documents',
  tasks: '/tasks',
  channels: '/channels',
  calls: '/calls',
  folders: '/folders',
  search: '/search',
} as const satisfies Record<ListView, string>;

const _isListViewPath = (path: string) => {
  return LIST_VIEW_PATHS[path as ListView] !== undefined;
};

export const LIST_VIEW_ID = {
  inbox: 'inbox',
  agents: 'agents',
  mail: 'mail',
  documents: 'documents',
  tasks: 'tasks',
  channels: 'channels',
  calls: 'calls',
  folders: 'folders',
  search: 'search',
} as const satisfies Record<ListView, string>;

export const isListViewID = (id: string | null | undefined): id is ListView => {
  if (!id) return false;

  return LIST_VIEWS.includes(id as 'inbox');
};

export const soupItemMatchesListView = (
  item: SoupApiItem,
  view: ListView | undefined
): boolean => {
  switch (view) {
    case 'agents':
      return item.tag === 'chat';
    case 'mail':
      return item.tag === 'emailThread';
    case 'documents':
      return item.tag === 'document' && item.data.subType?.type !== 'task';
    case 'tasks':
      return item.tag === 'document' && item.data.subType?.type === 'task';
    case 'channels':
      return item.tag === 'channel';
    case 'calls':
      return item.tag === 'call';
    case 'folders':
      return item.tag === 'project';
    case 'inbox':
    case 'search':
    case undefined:
      return true;
  }
};

const BLOCK_LIST_VIEW_MAP = {
  channel: 'channels',
  canvas: 'documents',
  chat: 'agents',
  code: 'documents',
  contact: 'channels',
  csv: 'documents',
  call: 'calls',
  email: 'mail',
  image: 'documents',
  md: 'documents',
  pdf: 'documents',
  project: 'folders',
  task: 'tasks',
  unknown: 'inbox',
  video: 'documents',
  write: 'documents',
  automation: 'agents',
} as const satisfies Record<BlockName | BlockAlias, ListView>;

const _getBlockListView = (block: BlockName | BlockAlias): ListView => {
  return BLOCK_LIST_VIEW_MAP[block];
};
