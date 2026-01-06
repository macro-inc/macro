import { describe, expect, test } from 'vitest';
import { extractFileSystemEntries } from '../dataTransfer';

function createMockDataTransfer(
  items: Array<{
    kind: string;
    webkitGetAsEntry?: () => FileSystemEntry | null;
    getAsFile?: () => File | null;
  }>
): DataTransfer {
  return {
    items: items as unknown as DataTransferItemList,
  } as DataTransfer;
}

function createMockFileEntry(name: string): FileSystemFileEntry {
  const file = new File(['content'], name, { type: 'image/png' });
  return {
    isFile: true,
    isDirectory: false,
    name,
    fullPath: `/${name}`,
    filesystem: {} as FileSystem,
    getParent: () => {},
    file: (callback: (file: File) => void) => callback(file),
  } as FileSystemFileEntry;
}

function createMockDirectoryEntry(name: string): FileSystemDirectoryEntry {
  return {
    isFile: false,
    isDirectory: true,
    name,
    fullPath: `/${name}`,
    filesystem: {} as FileSystem,
    getParent: () => {},
    createReader: () => ({}) as FileSystemDirectoryReader,
  } as FileSystemDirectoryEntry;
}

describe('extractFileSystemEntries', () => {
  test('returns empty arrays for null dataTransfer', () => {
    const result = extractFileSystemEntries(null);
    expect(result.fileEntries).toEqual([]);
    expect(result.directoryEntries).toEqual([]);
  });

  test('returns empty arrays for undefined dataTransfer', () => {
    const result = extractFileSystemEntries(undefined);
    expect(result.fileEntries).toEqual([]);
    expect(result.directoryEntries).toEqual([]);
  });

  test('returns empty arrays for empty items', () => {
    const dataTransfer = createMockDataTransfer([]);
    const result = extractFileSystemEntries(dataTransfer);
    expect(result.fileEntries).toEqual([]);
    expect(result.directoryEntries).toEqual([]);
  });

  test('skips non-file items', () => {
    const dataTransfer = createMockDataTransfer([
      { kind: 'string' },
      { kind: 'text' },
    ]);
    const result = extractFileSystemEntries(dataTransfer);
    expect(result.fileEntries).toEqual([]);
    expect(result.directoryEntries).toEqual([]);
  });

  test('extracts file entries from webkitGetAsEntry (drag and drop)', () => {
    const mockEntry = createMockFileEntry('test.png');
    const dataTransfer = createMockDataTransfer([
      {
        kind: 'file',
        webkitGetAsEntry: () => mockEntry,
        getAsFile: () => null,
      },
    ]);

    const result = extractFileSystemEntries(dataTransfer);
    expect(result.fileEntries).toHaveLength(1);
    expect(result.fileEntries[0]).toBe(mockEntry);
    expect(result.directoryEntries).toEqual([]);
  });

  test('extracts directory entries from webkitGetAsEntry (folder drag and drop)', () => {
    const mockDir = createMockDirectoryEntry('my-folder');
    const dataTransfer = createMockDataTransfer([
      {
        kind: 'file',
        webkitGetAsEntry: () => mockDir,
        getAsFile: () => null,
      },
    ]);

    const result = extractFileSystemEntries(dataTransfer);
    expect(result.fileEntries).toEqual([]);
    expect(result.directoryEntries).toHaveLength(1);
    expect(result.directoryEntries[0]).toBe(mockDir);
  });

  test('falls back to getAsFile when webkitGetAsEntry returns null (clipboard paste)', () => {
    const mockFile = new File(['image content'], 'screenshot.png', {
      type: 'image/png',
    });
    const dataTransfer = createMockDataTransfer([
      {
        kind: 'file',
        webkitGetAsEntry: () => null,
        getAsFile: () => mockFile,
      },
    ]);

    const result = extractFileSystemEntries(dataTransfer);
    expect(result.fileEntries).toHaveLength(1);
    expect(result.fileEntries[0].isFile).toBe(true);
    expect(result.fileEntries[0].isDirectory).toBe(false);
    expect(result.fileEntries[0].name).toBe('screenshot.png');
    expect(result.directoryEntries).toEqual([]);
  });

  test('synthetic file entry returns correct file via file() method', async () => {
    const mockFile = new File(['image content'], 'pasted-image.png', {
      type: 'image/png',
    });
    const dataTransfer = createMockDataTransfer([
      {
        kind: 'file',
        webkitGetAsEntry: () => null,
        getAsFile: () => mockFile,
      },
    ]);

    const result = extractFileSystemEntries(dataTransfer);
    const entry = result.fileEntries[0];

    const retrievedFile = await new Promise<File>((resolve) => {
      entry.file(resolve);
    });

    expect(retrievedFile).toBe(mockFile);
    expect(retrievedFile.name).toBe('pasted-image.png');
    expect(retrievedFile.type).toBe('image/png');
  });

  test('handles missing webkitGetAsEntry method', () => {
    const mockFile = new File(['content'], 'file.txt', { type: 'text/plain' });
    const dataTransfer = createMockDataTransfer([
      {
        kind: 'file',
        getAsFile: () => mockFile,
      },
    ]);

    const result = extractFileSystemEntries(dataTransfer);
    expect(result.fileEntries).toHaveLength(1);
    expect(result.fileEntries[0].name).toBe('file.txt');
  });

  test('skips items where both webkitGetAsEntry and getAsFile return null', () => {
    const dataTransfer = createMockDataTransfer([
      {
        kind: 'file',
        webkitGetAsEntry: () => null,
        getAsFile: () => null,
      },
    ]);

    const result = extractFileSystemEntries(dataTransfer);
    expect(result.fileEntries).toEqual([]);
    expect(result.directoryEntries).toEqual([]);
  });

  test('handles mixed items (files, directories, and clipboard pastes)', () => {
    const mockFileEntry = createMockFileEntry('dragged.txt');
    const mockDirEntry = createMockDirectoryEntry('dragged-folder');
    const mockPastedFile = new File(['pasted'], 'pasted.png', {
      type: 'image/png',
    });

    const dataTransfer = createMockDataTransfer([
      {
        kind: 'file',
        webkitGetAsEntry: () => mockFileEntry,
        getAsFile: () => null,
      },
      {
        kind: 'file',
        webkitGetAsEntry: () => mockDirEntry,
        getAsFile: () => null,
      },
      {
        kind: 'file',
        webkitGetAsEntry: () => null,
        getAsFile: () => mockPastedFile,
      },
      { kind: 'string' },
    ]);

    const result = extractFileSystemEntries(dataTransfer);
    expect(result.fileEntries).toHaveLength(2);
    expect(result.fileEntries[0]).toBe(mockFileEntry);
    expect(result.fileEntries[1].name).toBe('pasted.png');
    expect(result.directoryEntries).toHaveLength(1);
    expect(result.directoryEntries[0]).toBe(mockDirEntry);
  });
});
