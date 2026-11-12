export type PasswordKind =
  | 'login'
  | 'card'
  | 'note'
  | 'identity'
  | 'api'
  | 'verification_code';
export type PasswordItem = {
  id: string;
  teamId: string;
  name: string;
  kind: PasswordKind;
  url: string | null;
  folderId: string | null;
  favorite: boolean;
  version: number;
  hasTotp: boolean;
  shared: boolean;
  shareCount: number;
  /** The whole team can use it; false for an item kept to its creator. */
  sharedWithTeam: boolean;
  /** The viewer may share, move or delete it (its creator or a team admin). */
  canManage: boolean;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string | null;
};
export type PasswordValues = {
  username: string;
  password: string;
  notes: string;
  fields: { label: string; value: string }[];
};
export type PasswordFolder = {
  id: string;
  name: string;
  parentId: string | null;
};
export type PasswordGrant = {
  kind: 'user' | 'team';
  id: string;
  permission: 'view' | 'edit';
};
export type PasswordActivity = {
  id: string;
  action:
    | 'create'
    | 'update'
    | 'delete'
    | 'reveal'
    | 'copy'
    | 'share'
    | 'totp_setup'
    | 'totp_remove'
    | 'totp_code';
  occurredAt: string;
};
export type PasswordVersion = { version: number; createdAt: string };
export type PasswordDraft = {
  name: string;
  kind: PasswordKind;
  url: string;
  folderId: string | null;
  favorite: boolean;
  /** Only for new items: kept to its creator instead of shared with the team. */
  private: boolean;
  values: PasswordValues;
};
export type PasswordFilter =
  | 'all'
  | 'favorites'
  | 'recent'
  | 'shared'
  | `folder:${string}`;

/**
 * Items in a collection. A folder includes its subfolders' items; an item whose
 * folder no longer exists is treated as unfiled.
 */
export function filterItems(
  items: PasswordItem[],
  filter: PasswordFilter,
  search: string,
  folders: readonly PasswordFolder[] = []
) {
  const scope = filter.startsWith('folder:')
    ? folderSubtree(folders, filter.slice(7))
    : undefined;
  const query = search.trim().toLocaleLowerCase();
  const filtered = items.filter((item) => {
    if (filter === 'favorites' && !item.favorite) return false;
    if (filter === 'recent' && !item.lastUsedAt) return false;
    if (filter === 'shared' && !item.shared) return false;
    if (scope && !(item.folderId && scope.has(item.folderId))) return false;
    return `${item.name} ${item.url ?? ''}`.toLocaleLowerCase().includes(query);
  });
  if (filter === 'recent')
    filtered.sort((left, right) =>
      (right.lastUsedAt ?? '').localeCompare(left.lastUsedAt ?? '')
    );
  return filtered;
}

export function validateDraft(
  draft: PasswordDraft
): 'name' | 'url' | undefined {
  if (!draft.name.trim()) return 'name';
  if (draft.url) {
    try {
      const url = new URL(draft.url);
      if (url.protocol !== 'https:' && url.protocol !== 'http:') return 'url';
    } catch {
      return 'url';
    }
  }
}

export type PasswordRecipient = {
  kind: 'user' | 'team';
  id: string;
  name: string;
};

/** The folder and every folder under it; cycles from stale data stop the walk. */
export function folderSubtree(
  folders: readonly PasswordFolder[],
  id: string
): Set<string> {
  const result = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const folder of folders)
      if (
        folder.parentId &&
        result.has(folder.parentId) &&
        !result.has(folder.id)
      ) {
        result.add(folder.id);
        grew = true;
      }
  }
  return result;
}

/** Folder names from the top level down to `id`. */
export function folderPath(
  folders: readonly PasswordFolder[],
  id: string | null
): string[] {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const path: string[] = [];
  const seen = new Set<string>();
  let current = id ? byId.get(id) : undefined;
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    path.unshift(current.name);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return path;
}
