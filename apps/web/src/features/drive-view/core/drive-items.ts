import { isSameDay, subDays } from 'date-fns';
import { match } from 'ts-pattern';
import type {
  DriveRootBrowseMode,
  DriveSortDirection,
} from './drive-view-mode';
import type { DriveFolder, DriveSort } from './types';

export type DriveFolderSummary = DriveFolder & {
  userId: string;
  createdAt?: string;
  updatedAt?: string;
};

export type DriveItemKind =
  | 'folder'
  | 'markdown'
  | 'pdf'
  | 'image'
  | 'video'
  | 'spreadsheet'
  | 'database'
  | 'form'
  | 'code'
  | 'canvas'
  | 'docx'
  | 'snippet'
  | 'skill'
  | 'email'
  | 'chat'
  | 'file';

export type DriveTimeBucketId = 'today' | 'yesterday' | 'this_week' | 'earlier';

export type DriveComparableItem = {
  id: string;
  type: string;
  name: string;
  fileType?: string;
  subType?: { type: string } | null;
  projectId?: string;
  createdAt?: string | Date | number | null;
  updatedAt?: string | Date | number | null;
  viewedAt?: string | Date | number | null;
  touchedAt?: string | Date | number | null;
  sortTs?: string | Date | number | null;
};

const IMAGE_EXTENSIONS = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'svg',
  'webp',
  'avif',
  'bmp',
  'ico',
]);

const VIDEO_EXTENSIONS = new Set([
  'mp4',
  'mkv',
  'webm',
  'avi',
  'mov',
  'wmv',
  'mpg',
  'mpeg',
  'm4v',
  'flv',
  'f4v',
  'threegp',
]);

const CODE_EXTENSIONS = new Set([
  'ts',
  'tsx',
  'js',
  'jsx',
  'mjs',
  'cjs',
  'rs',
  'py',
  'go',
  'java',
  'kt',
  'swift',
  'c',
  'cpp',
  'cc',
  'h',
  'hpp',
  'cs',
  'rb',
  'php',
  'sh',
  'bash',
  'zsh',
  'sql',
  'json',
  'yaml',
  'yml',
  'toml',
  'xml',
  'html',
  'css',
  'scss',
  'less',
  'txt',
  'csv',
  'nix',
  'graphql',
  'gql',
]);

/** Counts immediate accessible child folders for each parent folder ID. */
export function countDirectSubfolders(
  folders: readonly DriveFolder[]
): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  const knownIds = new Set(folders.map((folder) => folder.id));

  for (const folder of folders) {
    if (!folder.parentId || !knownIds.has(folder.parentId)) continue;
    counts.set(folder.parentId, (counts.get(folder.parentId) ?? 0) + 1);
  }

  return counts;
}

/**
 * Splits accessible folders into owned ("My folders") and shared with the
 * viewer ("Shared folders"). A folder whose parent is in the other partition
 * stays reachable as a root of its own partition.
 */
export function splitOwnedAndSharedFolders<T extends DriveFolderSummary>(
  folders: readonly T[],
  userId: string | undefined
): { owned: T[]; shared: T[] } {
  if (!userId) return { owned: [...folders], shared: [] };

  const owned: T[] = [];
  const shared: T[] = [];

  for (const folder of folders) {
    if (folder.userId === userId) owned.push(folder);
    else shared.push(folder);
  }

  return { owned, shared };
}

/**
 * Returns top-level folders within the supplied set: those without a parent,
 * or whose parent is absent from the set (e.g. a shared subfolder whose parent
 * is not shared).
 */
export function topLevelFolders<T extends DriveFolder>(
  folders: readonly T[]
): T[] {
  const knownIds = new Set(folders.map((folder) => folder.id));
  return folders.filter(
    (folder) => !folder.parentId || !knownIds.has(folder.parentId)
  );
}

/** Returns immediate child folders of `parentId`, sorted naturally by name. */
export function directChildFolders<T extends DriveFolder>(
  folders: readonly T[],
  parentId: string | null
): T[] {
  const matched =
    parentId === null
      ? topLevelFolders(folders)
      : folders.filter((folder) => folder.parentId === parentId);

  return [...matched].sort((left, right) =>
    left.name.localeCompare(right.name, undefined, {
      numeric: true,
      sensitivity: 'base',
    })
  );
}

export function partitionFoldersAndFiles<T extends { type: string }>(
  items: readonly T[]
): { folders: T[]; files: T[] } {
  const folders: T[] = [];
  const files: T[] = [];

  for (const item of items) {
    if (item.type === 'project') folders.push(item);
    else files.push(item);
  }

  return { folders, files };
}

function toTimestampMs(
  value: string | Date | number | null | undefined
): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (value instanceof Date)
    return Number.isFinite(value.getTime()) ? value.getTime() : 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function itemSortTimestamp(item: DriveComparableItem, sort: DriveSort): number {
  if (item.type === 'database' || item.type === 'form') {
    return toTimestampMs(item.createdAt);
  }

  return match(sort)
    .with('created_at', () => toTimestampMs(item.sortTs ?? item.createdAt))
    .with('viewed_at', () => toTimestampMs(item.sortTs ?? item.viewedAt))
    .with('updated_at', () => toTimestampMs(item.sortTs ?? item.updatedAt))
    .with('name', () => toTimestampMs(item.updatedAt))
    .exhaustive();
}

function compareItemNames(
  left: DriveComparableItem,
  right: DriveComparableItem
): number {
  const leftName = left.name.trim();
  const rightName = right.name.trim();

  if (!leftName && rightName) return 1;
  if (leftName && !rightName) return -1;

  const cmp = leftName.localeCompare(rightName, undefined, {
    numeric: true,
    sensitivity: 'base',
  });
  if (cmp !== 0) return cmp;
  return left.id.localeCompare(right.id);
}

/**
 * Orders Drive items with optional Finder-style "Folders first" grouping and
 * explicit ascending/descending sort direction.
 */
export function orderDriveDisplayItems<T extends DriveComparableItem>(
  items: readonly T[],
  options: {
    foldersFirst: boolean;
    sort: DriveSort;
    direction: DriveSortDirection;
  }
): T[] {
  const factor = options.direction === 'asc' ? 1 : -1;

  return [...items].sort((left, right) => {
    if (options.foldersFirst) {
      const leftFolder = left.type === 'project' ? 0 : 1;
      const rightFolder = right.type === 'project' ? 0 : 1;
      if (leftFolder !== rightFolder) return leftFolder - rightFolder;
    }

    if (options.sort === 'name') {
      return compareItemNames(left, right) * factor;
    }

    const timeDiff =
      (itemSortTimestamp(left, options.sort) -
        itemSortTimestamp(right, options.sort)) *
      factor;
    if (timeDiff !== 0) return timeDiff;

    return compareItemNames(left, right);
  });
}

/**
 * On My Drive root, Browse mode shows top-level folders plus unfiled files;
 * All files mode (or any active search/filter) shows all matching files.
 */
export function filterRootBrowseItems<
  T extends Pick<DriveComparableItem, 'type' | 'projectId'>,
>(
  items: readonly T[],
  rootMode: DriveRootBrowseMode,
  isSearchingOrFiltered: boolean
): T[] {
  if (rootMode === 'all' || isSearchingOrFiltered) return [...items];

  return items.filter((item) => item.type === 'project' || !item.projectId);
}

/** Groups recent items into human time buckets: Today, Yesterday, This week, Earlier. */
export function groupByTimeBucket<T>(
  items: readonly T[],
  getDate: (item: T) => string | Date | number | null | undefined,
  now: Date = new Date()
): { bucket: DriveTimeBucketId; items: T[] }[] {
  const yesterday = subDays(now, 1);
  const weekCutoff = subDays(now, 7).getTime();
  const buckets: Record<DriveTimeBucketId, T[]> = {
    today: [],
    yesterday: [],
    this_week: [],
    earlier: [],
  };

  for (const item of items) {
    const ms = toTimestampMs(getDate(item));
    if (ms <= 0) {
      buckets.earlier.push(item);
      continue;
    }
    const date = new Date(ms);
    if (isSameDay(date, now)) buckets.today.push(item);
    else if (isSameDay(date, yesterday)) buckets.yesterday.push(item);
    else if (ms >= weekCutoff) buckets.this_week.push(item);
    else buckets.earlier.push(item);
  }

  const order: DriveTimeBucketId[] = [
    'today',
    'yesterday',
    'this_week',
    'earlier',
  ];

  return order
    .filter((bucket) => buckets[bucket].length > 0)
    .map((bucket) => ({ bucket, items: buckets[bucket] }));
}

const NON_DOCUMENT_KINDS: Record<string, DriveItemKind> = {
  project: 'folder',
  database: 'database',
  form: 'form',
  email: 'email',
  chat: 'chat',
};

const EXACT_EXTENSION_KINDS: Record<string, DriveItemKind> = {
  md: 'markdown',
  pdf: 'pdf',
  spreadsheet: 'spreadsheet',
  xlsx: 'spreadsheet',
  xls: 'spreadsheet',
  canvas: 'canvas',
  docx: 'docx',
  doc: 'docx',
};

function documentExtensionKind(ext: string): DriveItemKind {
  const exact = EXACT_EXTENSION_KINDS[ext];
  if (exact) return exact;
  if (IMAGE_EXTENSIONS.has(ext)) return 'image';
  if (VIDEO_EXTENSIONS.has(ext)) return 'video';
  if (CODE_EXTENSIONS.has(ext)) return 'code';
  return 'file';
}

/** Maps a Drive entity to a semantic kind key for column labels and badges. */
export function driveItemKind(
  item: Pick<DriveComparableItem, 'type' | 'fileType' | 'subType'>
): DriveItemKind {
  const nonDoc = NON_DOCUMENT_KINDS[item.type];
  if (nonDoc) return nonDoc;
  if (item.type !== 'document') return 'file';

  const subType = item.subType?.type;
  if (subType === 'snippet' || subType === 'skill') return subType;

  return documentExtensionKind((item.fileType ?? '').toLowerCase());
}

/**
 * Finder-style inline rename selection: selects the stem before the final
 * file extension (leaving `.pdf`, `.png`, `.ts` unselected), while selecting
 * the full name for folders, dot-files (`.env`), and extensionless names.
 */
export function renameSelectionRange(
  name: string,
  isFolder: boolean
): { start: number; end: number } {
  if (isFolder || name.length === 0) return { start: 0, end: name.length };

  const lastDot = name.lastIndexOf('.');
  if (lastDot <= 0 || lastDot === name.length - 1) {
    return { start: 0, end: name.length };
  }

  // Only treat short trailing tokens without spaces as file extensions.
  const ext = name.slice(lastDot + 1);
  if (ext.length > 10 || /\s/.test(ext)) {
    return { start: 0, end: name.length };
  }

  return { start: 0, end: lastDot };
}
