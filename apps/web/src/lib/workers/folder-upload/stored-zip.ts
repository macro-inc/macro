import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex } from '@noble/hashes/utils';

/**
 * A folder upload as one zip, written without compression.
 *
 * The archive is a `Blob` assembled from small header records and the picked
 * files themselves, so the browser streams the files from disk when it is
 * uploaded and never holds the folder in memory. Each file is read once, in
 * chunks, for its CRC-32 and for the SHA-256 of the whole archive that the
 * upload URL is signed with. A data descriptor after each file carries its
 * CRC-32, so the hash can cover every byte in a single pass.
 *
 * Folders the app accepts are mostly PDFs, images and office files, which are
 * already compressed, so storing them costs little upload size and saves the
 * time and memory compression takes.
 */

export type StoredZipFile = {
  /** Path inside the archive, starting with the picked folder's name. */
  path: string;
  file: File;
};

export type StoredZip = {
  blob: Blob;
  /** Hex SHA-256 of the whole archive. */
  sha256: string;
};

/** Bytes read from a file at a time, which bounds the memory a zip takes. */
const READ_CHUNK_BYTES = 8 * 1024 * 1024;

// Without ZIP64, sizes and offsets are 32-bit and entries are counted in 16
// bits. The folder limits keep uploads well inside both.
const MAX_ZIP_OFFSET = 0xffff_ffff;
const MAX_ZIP_ENTRIES = 0xffff;

const LOCAL_FILE_HEADER = 0x04034b50;
const DATA_DESCRIPTOR = 0x08074b50;
const CENTRAL_DIRECTORY_HEADER = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY = 0x06054b50;

const ZIP_VERSION = 20;
const UTF8_NAMES = 0x0800;
const SIZES_IN_DATA_DESCRIPTOR = 0x0008;
const DIRECTORY_ATTRIBUTE = 0x10;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** Continues a CRC-32 (`crc` is 0 to start) over `bytes`. */
export function crc32(crc: number, bytes: Uint8Array): number {
  let value = ~crc >>> 0;
  for (let i = 0; i < bytes.length; i++) {
    value = CRC_TABLE[(value ^ bytes[i]) & 0xff] ^ (value >>> 8);
  }
  return ~value >>> 0;
}

const encoder = new TextEncoder();

type Entry = {
  name: Uint8Array;
  isDirectory: boolean;
  dosTime: number;
  dosDate: number;
  crc: number;
  size: number;
  offset: number;
};

function dosDateTime(timestamp: number): { dosTime: number; dosDate: number } {
  const date = new Date(timestamp);
  // DOS dates start in 1980; earlier timestamps clamp to it.
  const year = Math.max(date.getFullYear(), 1980);
  return {
    dosTime:
      (date.getHours() << 11) |
      (date.getMinutes() << 5) |
      Math.floor(date.getSeconds() / 2),
    dosDate:
      ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

function flags(entry: Entry): number {
  return entry.isDirectory ? UTF8_NAMES : UTF8_NAMES | SIZES_IN_DATA_DESCRIPTOR;
}

function localFileHeader(entry: Entry): Uint8Array<ArrayBuffer> {
  const view = new DataView(new ArrayBuffer(30 + entry.name.length));
  view.setUint32(0, LOCAL_FILE_HEADER, true);
  view.setUint16(4, ZIP_VERSION, true);
  view.setUint16(6, flags(entry), true);
  view.setUint16(10, entry.dosTime, true);
  view.setUint16(12, entry.dosDate, true);
  // The CRC-32 and sizes (offsets 14 to 25) stay zero: files carry them in
  // their data descriptor, and folders have none.
  view.setUint16(26, entry.name.length, true);
  const bytes = new Uint8Array(view.buffer);
  bytes.set(entry.name, 30);
  return bytes;
}

function dataDescriptor(entry: Entry): Uint8Array<ArrayBuffer> {
  const view = new DataView(new ArrayBuffer(16));
  view.setUint32(0, DATA_DESCRIPTOR, true);
  view.setUint32(4, entry.crc, true);
  view.setUint32(8, entry.size, true);
  view.setUint32(12, entry.size, true);
  return new Uint8Array(view.buffer);
}

function centralDirectoryHeader(entry: Entry): Uint8Array<ArrayBuffer> {
  const view = new DataView(new ArrayBuffer(46 + entry.name.length));
  view.setUint32(0, CENTRAL_DIRECTORY_HEADER, true);
  view.setUint16(4, ZIP_VERSION, true);
  view.setUint16(6, ZIP_VERSION, true);
  view.setUint16(8, flags(entry), true);
  view.setUint16(12, entry.dosTime, true);
  view.setUint16(14, entry.dosDate, true);
  view.setUint32(16, entry.crc, true);
  view.setUint32(20, entry.size, true);
  view.setUint32(24, entry.size, true);
  view.setUint16(28, entry.name.length, true);
  view.setUint32(38, entry.isDirectory ? DIRECTORY_ATTRIBUTE : 0, true);
  view.setUint32(42, entry.offset, true);
  const bytes = new Uint8Array(view.buffer);
  bytes.set(entry.name, 46);
  return bytes;
}

function endOfCentralDirectory(
  entryCount: number,
  size: number,
  offset: number
): Uint8Array<ArrayBuffer> {
  const view = new DataView(new ArrayBuffer(22));
  view.setUint32(0, END_OF_CENTRAL_DIRECTORY, true);
  view.setUint16(8, entryCount, true);
  view.setUint16(10, entryCount, true);
  view.setUint32(12, size, true);
  view.setUint32(16, offset, true);
  return new Uint8Array(view.buffer);
}

/**
 * Every folder the archive holds: the explicit ones, each file's parents, and
 * their parents in turn.
 */
function folderNames(files: StoredZipFile[], folderPaths: string[]): string[] {
  const folders = new Set<string>();
  const addWithParents = (path: string) => {
    const segments = path.split('/');
    for (let depth = 1; depth <= segments.length; depth++) {
      folders.add(segments.slice(0, depth).join('/'));
    }
  };
  for (const folder of folderPaths) addWithParents(folder);
  for (const { path } of files) {
    const parent = path.split('/').slice(0, -1).join('/');
    if (parent) addWithParents(parent);
  }
  return [...folders].sort();
}

/**
 * Writes `files` and `folderPaths` (folders that must survive even when
 * empty) as one stored zip. `onProgress` reports bytes read so far.
 */
export async function buildStoredZip(
  files: StoredZipFile[],
  folderPaths: string[],
  onProgress?: (processedBytes: number, totalBytes: number) => void
): Promise<StoredZip> {
  const folders = folderNames(files, folderPaths);
  if (folders.length + files.length > MAX_ZIP_ENTRIES) {
    throw new Error('Folder has too many files and folders to upload at once');
  }

  const totalBytes = files.reduce((sum, { file }) => sum + file.size, 0);
  const hash = sha256.create();
  const parts: BlobPart[] = [];
  const entries: Entry[] = [];
  let offset = 0;
  let processedBytes = 0;

  const append = (bytes: Uint8Array<ArrayBuffer>) => {
    parts.push(bytes);
    hash.update(bytes);
    offset += bytes.length;
  };

  const now = Date.now();
  for (const folder of folders) {
    const entry: Entry = {
      name: encoder.encode(`${folder}/`),
      isDirectory: true,
      ...dosDateTime(now),
      crc: 0,
      size: 0,
      offset,
    };
    entries.push(entry);
    append(localFileHeader(entry));
  }

  for (const { path, file } of files) {
    const entry: Entry = {
      name: encoder.encode(path),
      isDirectory: false,
      ...dosDateTime(file.lastModified),
      crc: 0,
      size: file.size,
      offset,
    };
    append(localFileHeader(entry));

    // The archive references the file; only this pass reads its bytes.
    parts.push(file);
    for (let start = 0; start < file.size; start += READ_CHUNK_BYTES) {
      const chunk = new Uint8Array(
        await file.slice(start, start + READ_CHUNK_BYTES).arrayBuffer()
      );
      entry.crc = crc32(entry.crc, chunk);
      hash.update(chunk);
      processedBytes += chunk.length;
      onProgress?.(processedBytes, totalBytes);
    }
    offset += file.size;

    entries.push(entry);
    append(dataDescriptor(entry));
    if (offset > MAX_ZIP_OFFSET) {
      throw new Error('Folder is too large to upload at once');
    }
  }

  const centralDirectoryOffset = offset;
  for (const entry of entries) append(centralDirectoryHeader(entry));
  append(
    endOfCentralDirectory(
      entries.length,
      offset - centralDirectoryOffset,
      centralDirectoryOffset
    )
  );
  if (offset > MAX_ZIP_OFFSET) {
    throw new Error('Folder is too large to upload at once');
  }

  return {
    blob: new Blob(parts, { type: 'application/zip' }),
    sha256: bytesToHex(hash.digest()),
  };
}
