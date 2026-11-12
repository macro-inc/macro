import { match } from 'ts-pattern';
import { folderPath, type PasswordFolder, type PasswordItem } from './types';

/** The vault list returns at most this many items. */
export const VAULT_LIST_CAP = 500;
/** Names searched one by one when the loaded list is capped. */
export const MAX_DUPLICATE_SEARCHES = 100;

/** Vault folder limits (`crates/passwords`): per team, and depth from the root. */
export const MAX_TEAM_FOLDERS = 500;
export const MAX_FOLDER_DEPTH = 8;
/** The server takes at most 25 items and a 4 MiB body per batch. */
export const BATCH_ITEMS = 25;
export const BATCH_BYTES = 3.5 * 1024 * 1024;

/** Where source folders and unfiled items go. */
export type ImportTarget =
  | { kind: 'new'; name: string }
  | { kind: 'existing'; folderId: string }
  | { kind: 'root' };

/** What duplicate matching and batching read from a parsed item. */
export type ImportCandidate = {
  sourceKey: string;
  name: string;
  kind: string;
  url: string | null;
  folderKey: string | null;
};

/** A source folder: opaque key, parent key, and its path from the top level. */
export type ImportFolderNode = {
  key: string;
  name: string;
  parentKey: string | null;
  path: readonly string[];
};

/** Item failures worth sending again: the vault was busy or briefly unavailable. */
export function isRetryable(code: string | undefined) {
  return code === 'busy' || code === 'vault_unavailable';
}

/** Distinct item names, for searching the vault when its list is capped. */
export function candidateNames(items: readonly ImportCandidate[]) {
  const names = new Map<string, string>();
  for (const item of items) {
    const name = item.name.trim();
    const key = name.toLocaleLowerCase();
    if (name && !names.has(key)) names.set(key, name);
  }
  return [...names.values()];
}

function host(url: string | null) {
  if (!url) return '';
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

function identity(kind: string, name: string, url: string | null) {
  return `${kind}\u0000${name.trim().toLocaleLowerCase()}\u0000${host(url)}`;
}

/**
 * Source keys of items that look like ones already in the vault: same kind,
 * name (ignoring case and outer spaces) and website host. Only metadata the
 * vault already loaded is compared; no values are read.
 */
export function duplicateKeys(
  items: readonly ImportCandidate[],
  existing: readonly PasswordItem[]
): Set<string> {
  const known = new Set(
    existing.map((item) => identity(item.kind, item.name, item.url))
  );
  return new Set(
    items
      .filter((item) => known.has(identity(item.kind, item.name, item.url)))
      .map((item) => item.sourceKey)
  );
}

export type FolderCheck = {
  /** Folders the team would have after the import. */
  total: number;
  /** Deepest folder level after the import, counted from the vault root. */
  depth: number;
  tooMany: boolean;
  tooDeep: boolean;
};

/**
 * The vault refuses more than 500 folders per team or nesting deeper than 8,
 * and never flattens: check both before sending anything.
 */
export function checkFolders(
  target: ImportTarget,
  sourceFolders: readonly ImportFolderNode[],
  vaultFolders: readonly PasswordFolder[]
): FolderCheck {
  const targetDepth = match(target)
    .with(
      { kind: 'existing' },
      ({ folderId }) => folderPath(vaultFolders, folderId).length
    )
    .with({ kind: 'new' }, () => 1)
    .with({ kind: 'root' }, () => 0)
    .exhaustive();
  const sourceDepth = Math.max(
    0,
    ...sourceFolders.map((folder) => folder.path.length)
  );
  const total =
    vaultFolders.length +
    sourceFolders.length +
    (target.kind === 'new' ? 1 : 0);
  const depth = targetDepth + sourceDepth;
  return {
    total,
    depth,
    tooMany: total > MAX_TEAM_FOLDERS,
    tooDeep: depth > MAX_FOLDER_DEPTH,
  };
}

function byteLength(value: unknown) {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

/** The folders `items` reference, with their ancestors, parents first. */
export function foldersFor(
  items: readonly ImportCandidate[],
  folders: readonly ImportFolderNode[]
): { key: string; name: string; parentKey: string | null }[] {
  const byKey = new Map(folders.map((folder) => [folder.key, folder]));
  const wanted = new Set<string>();
  for (const item of items) {
    let key = item.folderKey;
    while (key && !wanted.has(key)) {
      wanted.add(key);
      key = byKey.get(key)?.parentKey ?? null;
    }
  }
  // `folders` is already parents-first, so filtering keeps that order.
  return folders
    .filter((folder) => wanted.has(folder.key))
    .map(({ key, name, parentKey }) => ({ key, name, parentKey }));
}

/**
 * Splits items into batches of at most `maxItems` whose serialized items and
 * folders stay under `maxBytes`. An item too large on its own goes alone and
 * the server answers for it.
 */
export function planBatches<Item extends ImportCandidate>(
  items: readonly Item[],
  folders: readonly ImportFolderNode[],
  limits: { maxItems: number; maxBytes: number } = {
    maxItems: BATCH_ITEMS,
    maxBytes: BATCH_BYTES,
  }
): Item[][] {
  const batches: Item[][] = [];
  let current: Item[] = [];
  let bytes = 0;
  const folderBytes = (batch: Item[]) => byteLength(foldersFor(batch, folders));
  for (const item of items) {
    const size = byteLength(item);
    const full =
      current.length >= limits.maxItems ||
      (current.length > 0 &&
        bytes + size + folderBytes([...current, item]) > limits.maxBytes);
    if (full) {
      batches.push(current);
      current = [];
      bytes = 0;
    }
    current.push(item);
    bytes += size;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

/** What one import did, by item count. */
export type ImportTally = {
  created: number;
  alreadyPresent: number;
  /** Duplicates left out by choice, and items the parser skipped. */
  skipped: number;
  failed: number;
};
