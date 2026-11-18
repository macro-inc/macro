/** A folder a host view has already loaded. */
export type KnownFolder = {
  id: string;
  name: string;
  parentId?: string | null;
  ownerId: string;
};

/** A folder with the names from the root down to it. */
export type KnownFolderPath = {
  id: string;
  name: string;
  ownerId: string;
  path: string[];
};

/**
 * The folder's path when it and every folder above it are in `folders`.
 * A missing ancestor (one the view does not hold) or a cycle gives
 * undefined, so the caller asks the server instead of showing a partial path.
 */
export function knownFolderPath(
  folders: ReadonlyMap<string, KnownFolder>,
  id: string
): KnownFolderPath | undefined {
  const folder = folders.get(id);
  if (!folder) return undefined;

  const path: string[] = [];
  const seen = new Set<string>();
  let current: KnownFolder | undefined = folder;
  while (current) {
    if (seen.has(current.id)) return undefined;
    seen.add(current.id);
    path.unshift(current.name);
    if (!current.parentId) {
      return {
        id: folder.id,
        name: folder.name,
        ownerId: folder.ownerId,
        path,
      };
    }
    current = folders.get(current.parentId);
  }
  return undefined;
}
