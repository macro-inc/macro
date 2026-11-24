import { isNamedForPeople } from '@app/features/channel/group-chat-name';
import type { EntityData } from '@entity';
import type { WithSearch } from '@entity/types/search';

/** The local name matches whose list row data comes from Soup. */
export function featuredDocumentIds(local: readonly EntityData[]): string[] {
  return local
    .filter((entity) => entity.type === 'document')
    .map((entity) => entity.id);
}

/**
 * Gives each local name match the row data its Soup record carries, keeping
 * the match's own highlight.
 */
export function withFeaturedDocumentData<T extends WithSearch<EntityData>>(
  local: readonly T[],
  documents: readonly EntityData[]
): T[] {
  if (documents.length === 0) return [...local];
  const byId = new Map(documents.map((document) => [document.id, document]));
  return local.map((entity) => {
    const document = byId.get(entity.id);
    if (!document || document.type !== entity.type) return entity;
    return { ...document, search: entity.search } as T;
  });
}

/**
 * Moves the featured rows that the list still shows to its top. A featured id
 * the view's filters dropped is not featured. Folded ids leave the list until
 * they are featured.
 */
export function featureSearchResults<T extends { id: string }>(
  entities: readonly T[],
  featuredIds: readonly string[],
  foldedIds: readonly string[] = []
): { entities: T[]; featuredIds: string[] } {
  const folded = new Set(foldedIds);
  const listed = folded.size
    ? entities.filter((entity) => !folded.has(entity.id))
    : entities;
  if (featuredIds.length === 0)
    return { entities: [...listed], featuredIds: [] };
  const byId = new Map(listed.map((entity) => [entity.id, entity]));
  const featured = featuredIds.flatMap((id) => {
    const entity = byId.get(id);
    return entity ? [entity] : [];
  });
  const shown = new Set(featured.map((entity) => entity.id));
  return {
    entities: [
      ...featured,
      ...listed.filter((entity) => !shown.has(entity.id)),
    ],
    featuredIds: featured.map((entity) => entity.id),
  };
}

/** The most name matches Search lists above the rest of its results. */
export const BEST_MATCH_COUNT = 3;

/**
 * How well a name matches the typed text, best first: the whole name, its
 * first word, the start of its first word, the start of a later word, inside
 * a word, or neither (a loose fuzzy match).
 */
function nameMatchLevel(name: string, text: string) {
  const lowered = name.toLowerCase();
  const query = text.trim().toLowerCase();
  if (!query) return 5;
  if (lowered === query) return 0;
  const isWordCharacter = (char: string | undefined) =>
    char !== undefined && /[\p{L}\p{N}]/u.test(char);
  if (lowered.startsWith(query))
    return isWordCharacter(lowered[query.length]) ? 2 : 1;
  let at = lowered.indexOf(query);
  if (at === -1) return 5;
  while (at !== -1) {
    if (!isWordCharacter(lowered[at - 1])) return 3;
    at = lowered.indexOf(query, at + 1);
  }
  return 4;
}

type BestMatchKind = 'direct-message' | 'channel' | 'item' | 'group-chat';

function bestMatchKind(entity: EntityData): BestMatchKind {
  if (entity.type !== 'channel') return 'item';
  if (entity.channelType === 'direct_message') return 'direct-message';
  if (entity.channelType === 'private' && isNamedForPeople(entity.name))
    return 'group-chat';
  return 'channel';
}

const KIND_ORDER: Record<BestMatchKind, number> = {
  'direct-message': 0,
  channel: 0,
  item: 1,
  'group-chat': 2,
};

/**
 * Search's best matches among the local name matches: one-to-one DMs whose
 * person matches the text, then everything else by how well its name matches
 * (whole name, first word, its start, a later word, inside a word), channels before
 * documents and tasks before group chats, smaller group chats first. The
 * first {@link BEST_MATCH_COUNT} lead the list; the other chats wait behind
 * one row, so a first name shared by dozens of chats stays one screen of
 * results. Ties keep the local search's own order.
 */
export function rankBestMatches(
  local: readonly EntityData[],
  text: string
): { best: string[]; moreChats: string[] } {
  const ranked = local
    .map((entity, index) => {
      const kind = bestMatchKind(entity);
      const level = nameMatchLevel(entity.name, text);
      return {
        entity,
        index,
        kind,
        level,
        leads: kind === 'direct-message' && level <= 3,
        members: kind === 'group-chat' ? entity.name.split(', ').length : 0,
      };
    })
    .sort(
      (a, b) =>
        Number(b.leads) - Number(a.leads) ||
        a.level - b.level ||
        KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
        a.members - b.members ||
        a.index - b.index
    );
  const best = ranked.slice(0, BEST_MATCH_COUNT);
  return {
    best: best.map((match) => match.entity.id),
    moreChats: ranked
      .slice(BEST_MATCH_COUNT)
      .filter((match) => match.entity.type === 'channel')
      .map((match) => match.entity.id),
  };
}
