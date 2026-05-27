import type { BlockAlias, BlockName } from '@core/block';
import type { SoupApiItem } from '@service-storage/generated/schemas';
import { match } from 'ts-pattern';

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
): boolean =>
  match(view)
    .with('agents', () => item.tag === 'chat')
    .with('mail', () => item.tag === 'emailThread')
    .with(
      'documents',
      () => item.tag === 'document' && item.data.subType?.type !== 'task'
    )
    .with(
      'tasks',
      () => item.tag === 'document' && item.data.subType?.type === 'task'
    )
    .with('channels', () => item.tag === 'channel')
    .with('calls', () => item.tag === 'call')
    .with('folders', () => item.tag === 'project')
    .with('inbox', 'search', undefined, () => true)
    .exhaustive();

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
