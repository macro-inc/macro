/**
 * Extracts file and directory entries from a DataTransfer object or DataTransferItemList.
 * This utility works with both drag events (DragEvent.dataTransfer) and paste events (ClipboardEvent.clipboardData).
 *
 * @param dataTransfer - The DataTransfer object from a drag or paste event
 * @returns An object containing arrays of file entries and directory entries
 */
export function extractFileSystemEntries(
  dataTransfer: DataTransfer | null | undefined
): {
  fileEntries: FileSystemFileEntry[];
  directoryEntries: FileSystemDirectoryEntry[];
} {
  const fileEntries: FileSystemFileEntry[] = [];
  const directoryEntries: FileSystemDirectoryEntry[] = [];

  if (!dataTransfer) {
    return { fileEntries, directoryEntries };
  }

  const items = dataTransfer.items;
  if (!items || items.length === 0) {
    return { fileEntries, directoryEntries };
  }

  for (const item of items) {
    if (item.kind !== 'file') continue;

    const entry = item.webkitGetAsEntry ? item.webkitGetAsEntry() : null;
    if (!entry) {
      continue;
    }

    if (entry.isDirectory) {
      directoryEntries.push(entry as FileSystemDirectoryEntry);
    } else if (entry.isFile) {
      fileEntries.push(entry as FileSystemFileEntry);
    }
  }

  return { fileEntries, directoryEntries };
}
