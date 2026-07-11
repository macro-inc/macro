import type { TagFilterMode } from '@app/component/next-soup/filters/filter-store/types';
import type { EntityData } from '@entity';
import type {
  SoupApiItem,
  SoupProperty,
} from '@service-storage/generated/schemas';
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

const propertiesMatchTagFilter = (
  properties: readonly SoupProperty[] | undefined,
  tagOptionIds: readonly string[],
  mode: TagFilterMode
): boolean => {
  if (tagOptionIds.length === 0) return true;
  if (!properties?.length) return false;
  const held = new Set<string>();
  for (const { value } of properties) {
    if (value?.type === 'SelectOption') {
      for (const id of value.value) held.add(id);
    }
  }
  return mode === 'all'
    ? tagOptionIds.every((id) => held.has(id))
    : tagOptionIds.some((id) => held.has(id));
};

/**
 * Whether a soup item carries the given tag option ids — at least one of them
 * ('any', the default) or every one ('all'). Tags are SelectOption property
 * values on the item and option ids are globally unique, so the owning
 * definition is not consulted. An empty filter matches everything. Used to
 * gate optimistic websocket inserts so the grouped render (which skips client
 * predicates) still honors an active tag filter.
 */
export const soupItemMatchesTagFilter = (
  item: SoupApiItem,
  tagOptionIds: readonly string[],
  mode: TagFilterMode = 'any'
): boolean =>
  propertiesMatchTagFilter(
    'properties' in item.data ? item.data.properties : undefined,
    tagOptionIds,
    mode
  );

/**
 * `soupItemMatchesTagFilter` for mapped entities. Rendered rows are checked
 * against the active tag filter because the server only tag-filters the
 * document/chat/project soup unions and the document search leg. Entity types
 * without loaded properties (channels, calls, search-service email results)
 * never match, so they are excluded rather than leaking through unfiltered.
 */
export const entityMatchesTagFilter = (
  entity: EntityData,
  tagOptionIds: readonly string[],
  mode: TagFilterMode = 'any'
): boolean =>
  propertiesMatchTagFilter(
    'properties' in entity ? entity.properties : undefined,
    tagOptionIds,
    mode
  );
