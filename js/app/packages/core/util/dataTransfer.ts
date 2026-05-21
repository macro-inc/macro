type ExtractedEntries = {
  fileEntries: FileSystemFileEntry[];
  directoryEntries: FileSystemDirectoryEntry[];
};

const EMPTY_RESULT: ExtractedEntries = {
  fileEntries: [],
  directoryEntries: [],
};

/**
 * Extracts file and directory entries from a DataTransfer object.
 * Works with both drag events and paste events.
 */
export function extractFileSystemEntries(
  dataTransfer: DataTransfer | null | undefined
): ExtractedEntries {
  const items = getFileItems(dataTransfer);
  if (items.length === 0) return EMPTY_RESULT;

  const entries = items.map(itemToEntry).filter(isNonNull);
  return partitionEntries(entries);
}

function getFileItems(
  dataTransfer: DataTransfer | null | undefined
): DataTransferItem[] {
  if (!dataTransfer?.items) return [];
  return Array.from(dataTransfer.items).filter((item) => item.kind === 'file');
}

function itemToEntry(
  item: DataTransferItem
): FileSystemFileEntry | FileSystemDirectoryEntry | null {
  const entry = item.webkitGetAsEntry?.() ?? null;
  if (entry) return entry as FileSystemFileEntry | FileSystemDirectoryEntry;

  // Fallback for clipboard paste where webkitGetAsEntry returns null
  const file = item.getAsFile();
  return file ? createSyntheticFileEntry(file) : null;
}

function partitionEntries(
  entries: (FileSystemFileEntry | FileSystemDirectoryEntry)[]
): ExtractedEntries {
  const fileEntries: FileSystemFileEntry[] = [];
  const directoryEntries: FileSystemDirectoryEntry[] = [];

  for (const entry of entries) {
    if (entry.isDirectory) {
      directoryEntries.push(entry as FileSystemDirectoryEntry);
    } else if (entry.isFile) {
      fileEntries.push(entry as FileSystemFileEntry);
    }
  }

  return { fileEntries, directoryEntries };
}

function createSyntheticFileEntry(file: File): FileSystemFileEntry {
  return {
    isFile: true,
    isDirectory: false,
    name: file.name,
    fullPath: `/${file.name}`,
    filesystem: {} as FileSystem,
    getParent: () => {},
    file: (successCallback: (file: File) => void) => {
      successCallback(file);
    },
  } as FileSystemFileEntry;
}

/**
 * Reads image entries from the async Clipboard API.
 *
 * Needed on mobile (especially iOS Safari) where ClipboardEvent.clipboardData
 * frequently omits image files, leaving navigator.clipboard.read() as the only
 * way to recover the binary data. Safe to call without arguments — returns an
 * empty array when the API is unavailable or access is denied.
 */
export async function readImageEntriesFromAsyncClipboard(): Promise<
  FileSystemFileEntry[]
> {
  if (typeof navigator === 'undefined' || !navigator.clipboard?.read) {
    return [];
  }

  let items: ClipboardItems;
  try {
    items = await navigator.clipboard.read();
  } catch {
    return [];
  }

  const entries: FileSystemFileEntry[] = [];
  for (const item of items) {
    for (const type of item.types) {
      if (!type.startsWith('image/')) continue;
      try {
        const blob = await item.getType(type);
        const extension = type.slice('image/'.length) || 'bin';
        const file = new File(
          [blob],
          `pasted-image-${Date.now()}.${extension}`,
          { type }
        );
        entries.push(createSyntheticFileEntry(file));
      } catch {
        // Ignore individual type failures — surface whatever else we can read.
      }
    }
  }
  return entries;
}

function isNonNull<T>(value: T | null): value is T {
  return value !== null;
}
