import type { BlockAlias, BlockName } from '@core/block';

export const LIST_VIEWS = [
  'inbox',
  'agents',
  'mail',
  'documents',
  'tasks',
  'channels',
  'files',
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
  files: '/files',
  search: '/search',
} as const satisfies Record<ListView, string>;

export const isListViewPath = (path: string) => {
  return LIST_VIEW_PATHS[path as ListView] !== undefined;
};

export const LIST_VIEW_ID = {
  inbox: 'inbox',
  agents: 'agents',
  mail: 'mail',
  documents: 'documents',
  tasks: 'tasks',
  channels: 'channels',
  files: 'files',
  search: 'search',
} as const satisfies Record<ListView, string>;

export const isListViewID = (id: string | null | undefined): id is ListView => {
  if (!id) return false;

  return LIST_VIEWS.includes(id as 'inbox');
};

const BLOCK_LIST_VIEW_MAP = {
  channel: 'channels',
  canvas: 'documents',
  chat: 'agents',
  code: 'files',
  contact: 'channels',
  csv: 'files',
  email: 'mail',
  image: 'files',
  md: 'documents',
  pdf: 'files',
  project: 'files',
  task: 'tasks',
  unknown: 'inbox',
  video: 'files',
  write: 'files',
} as const satisfies Record<BlockName | BlockAlias, ListView>;

export const getBlockListView = (block: BlockName | BlockAlias): ListView => {
  return BLOCK_LIST_VIEW_MAP[block];
};
