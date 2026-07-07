type ExtractedEntries = {
  fileEntries: FileSystemFileEntry[];
  directoryEntries: FileSystemDirectoryEntry[];
};

/**
 * Reads the system clipboard into a DataTransfer — rich text/html when the
 * browser grants clipboard read access, plain text otherwise — so the
 * content can be replayed through paste pipelines that expect paste-event
 * data. Returns null when the clipboard is empty or unreadable. Must be
 * called from a user gesture on mobile browsers.
 */
export async function readClipboardAsDataTransfer(): Promise<DataTransfer | null> {
  const dataTransfer = new DataTransfer();
  try {
    for (const item of await navigator.clipboard.read()) {
      for (const type of item.types) {
        if (type !== 'text/html' && type !== 'text/plain') continue;
        const blob = await item.getType(type);
        dataTransfer.setData(type, await blob.text());
      }
    }
  } catch {
    const text = await navigator.clipboard.readText().catch(() => '');
    if (text) dataTransfer.setData('text/plain', text);
  }
  return dataTransfer.types.length > 0 ? dataTransfer : null;
}

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

export function createSyntheticFileEntry(file: File): FileSystemFileEntry {
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

function isNonNull<T>(value: T | null): value is T {
  return value !== null;
}
