import { match } from 'ts-pattern';
import { folderPath, type PasswordFolder, type PasswordItem } from './types';

/** The vault list returns at most this many items. */
export const VAULT_LIST_CAP = 500;
/** Most names one duplicate-match request carries (and items it returns). */
export const MATCH_NAMES = 500;
/**
 * Most bytes of names (as JSON) in one match request: under the vault's
 * 256 KiB body limit for ordinary routes, which escaped names could pass.
 */
export const MATCH_BYTES = 192 * 1024;

/**
 * Vault folder limits: per team, and depth from the root. These and the batch
 * limits mirror `password_import::vault` (`@core/password-import/limits.json`);
 * a test checks they match.
 */
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

/**
 * `base`, or the first free `numbered(n)` (n = 2, 3, …) when a root folder
 * already has that name, ignoring case.
 */
export function uniqueRootFolderName(
  base: string,
  vaultFolders: readonly PasswordFolder[],
  numbered: (number: number) => string
) {
  const taken = new Set(
    vaultFolders
      .filter((folder) => folder.parentId === null)
      .map((folder) => folder.name.trim().toLowerCase())
  );
  if (!taken.has(base.toLowerCase())) return base;
  for (let number = 2; ; number++) {
    const name = numbered(number);
    if (!taken.has(name.toLowerCase())) return name;
  }
}

/**
 * An item name as duplicates compare it: outer whitespace trimmed, lower case
 * (not locale-dependent). Names sent to the vault's match are already in this
 * form, and the vault compares them with `lower(name)`.
 */
export function normalizedName(name: string) {
  return name.trim().toLowerCase();
}

/** Distinct normalized item names, for matching in the vault when its list is capped. */
export function candidateNames(items: readonly ImportCandidate[]) {
  const names = new Set<string>();
  for (const item of items) {
    const name = normalizedName(item.name);
    if (name) names.add(name);
  }
  return [...names];
}

/**
 * `names` in request-sized chunks: at most `maxCount` names and `maxBytes` of
 * them as JSON strings each. A name over `maxBytes` on its own goes alone.
 */
export function chunkNames(
  names: readonly string[],
  maxCount: number,
  maxBytes: number
) {
  const encoder = new TextEncoder();
  const chunks: string[][] = [];
  let chunk: string[] = [];
  let bytes = 0;
  for (const name of names) {
    // The name as a JSON string, plus its separating comma.
    const size = encoder.encode(JSON.stringify(name)).length + 1;
    if (
      chunk.length > 0 &&
      (chunk.length >= maxCount || bytes + size > maxBytes)
    ) {
      chunks.push(chunk);
      chunk = [];
      bytes = 0;
    }
    chunk.push(name);
    bytes += size;
  }
  if (chunk.length > 0) chunks.push(chunk);
  return chunks;
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
  return `${kind}\u0000${normalizedName(name)}\u0000${host(url)}`;
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
