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
  'companies',
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
  companies: '/companies',
  folders: '/folders',
  search: '/search',
} as const satisfies Record<ListView, string>;

export const LIST_VIEW_ID = {
  inbox: 'inbox',
  agents: 'agents',
  mail: 'mail',
  documents: 'documents',
  tasks: 'tasks',
  channels: 'channels',
  calls: 'calls',
  companies: 'companies',
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
    .with('companies', () => item.tag === 'crmCompany')
    .exhaustive();

/**
 * Whether a soup item carries at least one of the given tag option ids. Tags are
 * SelectOption property values on the item and option ids are globally unique, so
 * the owning definition is not consulted. An empty filter matches everything.
 * Used to gate optimistic websocket inserts so the grouped render (which skips
 * client predicates) still honors an active tag filter.
 */
export const soupItemMatchesTagFilter = (
  item: SoupApiItem,
  tagOptionIds: readonly string[]
): boolean => {
  if (tagOptionIds.length === 0) return true;
  const properties =
    'properties' in item.data ? item.data.properties : undefined;
  if (!properties?.length) return false;
  const wanted = new Set(tagOptionIds);
  for (const { value } of properties) {
    if (
      value?.type === 'SelectOption' &&
      value.value.some((id) => wanted.has(id))
    ) {
      return true;
    }
  }
  return false;
};
