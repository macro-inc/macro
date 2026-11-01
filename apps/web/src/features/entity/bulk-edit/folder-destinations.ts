import { compareDateDesc } from '@core/util/date';
import { createFreshSearch, NAME_MATCH_RANKING } from '@core/util/freshSort';
import type { FolderRow } from '@queries/storage/folder-list';
import { type EntityData, getEntityProjectId } from '../types/entity';

export type FolderGroup = 'open' | 'created' | 'shared';

export type FolderDestination = {
  kind: 'folder';
  id: string;
  name: string;
  /** The folders above this one, outermost first. */
  path: string;
  group: FolderGroup;
};

export type FolderPickerItem =
  | FolderDestination
  | { kind: 'create'; name: string };

// Boosts order rows within a name-match group; they never lift a row past a
// better name match.
const GROUP_SEARCH_BOOST: Record<FolderGroup, number> = {
  open: 0.5,
  created: 0.2,
  shared: 0,
};

const searchFolders = createFreshSearch<FolderDestination>({
  config: {
    ...NAME_MATCH_RANKING,
    timeWeight: 0,
    boostFn: (folder) => GROUP_SEARCH_BOOST[folder.group],
  },
  getName: (folder) => folder.name,
  getTimestamp: () => ({}),
});

/** A folder followed by its parents, tolerating missing or looping parents. */
function folderAncestry(
  folders: ReadonlyMap<string, FolderRow>,
  folderId: string
): FolderRow[] {
  const ancestry: FolderRow[] = [];
  const seen = new Set<string>();
  let current = folders.get(folderId);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    ancestry.push(current);
    current = current.parentId ? folders.get(current.parentId) : undefined;
  }
  return ancestry;
}

export const indexFolders = (
  folders: readonly FolderRow[]
): ReadonlyMap<string, FolderRow> =>
  new Map(folders.map((folder) => [folder.id, folder]));

/**
 * The entities a move into the folder would change. Empty when there is
 * nothing to do, or when a folder would land inside itself.
 */
export function entitiesToMove<TEntity extends EntityData>(
  entities: readonly TEntity[],
  folderId: string,
  folders: ReadonlyMap<string, FolderRow>
): TEntity[] {
  const ancestors = new Set(
    folderAncestry(folders, folderId).map((folder) => folder.id)
  ).add(folderId);
  if (entities.some((e) => e.type === 'project' && ancestors.has(e.id))) {
    return [];
  }
  return entities.filter((entity) => getEntityProjectId(entity) !== folderId);
}

/**
 * Where these entities can go: folders open in a split in split order, then
 * the ones the user created, then the ones shared with them, each newest first.
 */
export function folderDestinations(options: {
  folders: readonly FolderRow[];
  openFolderIds: readonly string[];
  userId: string | undefined;
  entities: readonly EntityData[];
}): FolderDestination[] {
  const { folders, openFolderIds, userId, entities } = options;
  const index = indexFolders(folders);

  const groupOf = (folder: FolderRow): FolderGroup => {
    if (openFolderIds.includes(folder.id)) return 'open';
    return folder.userId === userId ? 'created' : 'shared';
  };
  const position = ({ group, id }: FolderDestination) => {
    if (group === 'open') return openFolderIds.indexOf(id);
    return openFolderIds.length + (group === 'created' ? 0 : 1);
  };

  return folders
    .toSorted((a, b) => compareDateDesc(a.createdAt, b.createdAt))
    .filter((folder) => entitiesToMove(entities, folder.id, index).length > 0)
    .map(
      (folder): FolderDestination => ({
        kind: 'folder',
        id: folder.id,
        name: folder.name,
        path: folderAncestry(index, folder.id)
          .slice(1)
          .reverse()
          .map((parent) => parent.name)
          .join(' / '),
        group: groupOf(folder),
      })
    )
    .toSorted((a, b) => position(a) - position(b));
}

/**
 * The picker's rows for a typed query: name matches, then a row that creates
 * a folder with that name unless one already has it.
 */
export function folderPickerItems(
  destinations: FolderDestination[],
  query: string
): FolderPickerItem[] {
  const name = query.trim();
  if (!name) return destinations;

  const matches = searchFolders(destinations, name)
    .toSorted(
      (a, b) =>
        b.nameMatchRank - a.nameMatchRank || b.combinedScore - a.combinedScore
    )
    .map(({ item }) => item);
  const exists = destinations.some(
    (folder) => folder.name.toLocaleLowerCase() === name.toLocaleLowerCase()
  );
  return exists ? matches : [...matches, { kind: 'create', name }];
}
