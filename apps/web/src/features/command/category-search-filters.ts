import type { SearchIndexId } from '@app/features/next-soup/core/search-filters';
import type { EntitySearchCategory } from './queries/entity-search';

// Each Cmd+K category maps to a search-view index type: the `type:` the
// Search field opens with. Cmd+K DMs
// maps to the same channels index as Channels for now; channelType-based
// narrowing (DMs vs non-DMs) is left for a follow-up once the search
// backend honors it.
const CATEGORY_TO_INDEX: Partial<
  Record<EntitySearchCategory | 'commands', SearchIndexId>
> = {
  email: 'email',
  people: 'channels',
  channels: 'channels',
  dms: 'channels',
  documents: 'document-or-file',
  tasks: 'task',
  chats: 'agent',
};

/** The Search view type a Cmd+K category searches, if it has one. */
export function categorySearchIndex(
  category: EntitySearchCategory | 'commands'
): SearchIndexId | undefined {
  return CATEGORY_TO_INDEX[category];
}

/** The name results each `type:` narrows the phone's search to. */
const INDEX_TO_CATEGORY: Partial<Record<SearchIndexId, EntitySearchCategory>> =
  {
    email: 'email',
    channels: 'channels',
    'document-or-file': 'documents',
    task: 'tasks',
    agent: 'chats',
  };

/** The name-search category that lists exactly a Search view type, if any. */
export const searchIndexCategory = (index: SearchIndexId) =>
  INDEX_TO_CATEGORY[index];
