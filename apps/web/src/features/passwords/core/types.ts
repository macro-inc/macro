export type PasswordKind = 'login' | 'card' | 'note' | 'identity' | 'api';
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
export type PasswordFolder = { id: string; name: string };
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
  values: PasswordValues;
};
export type PasswordFilter =
  | 'all'
  | 'favorites'
  | 'recent'
  | 'shared'
  | `folder:${string}`;

export function filterItems(
  items: PasswordItem[],
  filter: PasswordFilter,
  search: string
) {
  const query = search.trim().toLocaleLowerCase();
  const filtered = items.filter((item) => {
    if (filter === 'favorites' && !item.favorite) return false;
    if (filter === 'recent' && !item.lastUsedAt) return false;
    if (filter === 'shared' && !item.shared) return false;
    if (filter.startsWith('folder:') && item.folderId !== filter.slice(7))
      return false;
    return `${item.name} ${item.url ?? ''}`.toLocaleLowerCase().includes(query);
  });
  if (filter === 'recent')
    filtered.sort((left, right) =>
      (right.lastUsedAt ?? '').localeCompare(left.lastUsedAt ?? '')
    );
  return filtered;
}

export function generatePassword(length: number) {
  if (!Number.isInteger(length) || length < 12 || length > 128)
    throw new Error('Invalid password length');
  const alphabet =
    'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%&*+-=?';
  const ceiling = 256 - (256 % alphabet.length);
  let password = '';
  while (password.length < length) {
    const bytes = crypto.getRandomValues(new Uint8Array(length * 2));
    for (const byte of bytes) {
      if (byte < ceiling && password.length < length)
        password += alphabet[byte % alphabet.length];
    }
  }
  return password;
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
