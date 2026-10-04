import { inflateSync, strFromU8 } from 'fflate';
import {
  XLSX_MAX_BYTES,
  XLSX_MAX_ENTRIES,
  XLSX_MAX_EXPANDED_BYTES,
} from './workbook-file-types';

const invalid = () =>
  new Error('This is not a valid, unencrypted .xlsx workbook.');
const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++)
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

type ArchiveEntry = {
  name: string;
  size: number;
  compressed: number;
  offset: number;
  crc: number;
  method: number;
};

/** Validate the ZIP directory: bounded, unencrypted, no path aliases. */
function archiveEntries(bytes: Uint8Array): {
  entries: ArchiveEntry[];
  centralStart: number;
} {
  if (bytes.byteLength > XLSX_MAX_BYTES)
    throw new Error(
      `Choose an Excel workbook up to ${XLSX_MAX_BYTES / 1024 / 1024} MB.`
    );
  if (bytes.byteLength < 22) throw invalid();
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = bytes.length - 22;
  while (
    end >= Math.max(0, bytes.length - 65_557) &&
    data.getUint32(end, true) !== 0x06054b50
  )
    end--;
  if (
    end < 0 ||
    data.getUint32(end, true) !== 0x06054b50 ||
    end + 22 + data.getUint16(end + 20, true) !== bytes.length
  )
    throw invalid();
  const count = data.getUint16(end + 10, true);
  const centralSize = data.getUint32(end + 12, true);
  const centralStart = data.getUint32(end + 16, true);
  if (
    data.getUint32(end + 4, true) !== 0 ||
    count !== data.getUint16(end + 8, true) ||
    !count ||
    count > XLSX_MAX_ENTRIES ||
    centralStart + centralSize !== end
  )
    throw invalid();
  const entries: ArchiveEntry[] = [];
  let offset = centralStart;
  let expanded = 0;
  const names = new Set<string>();
  for (let index = 0; index < count; index++) {
    if (offset + 46 > end || data.getUint32(offset, true) !== 0x02014b50)
      throw invalid();
    const flags = data.getUint16(offset + 8, true);
    const method = data.getUint16(offset + 10, true);
    const compressed = data.getUint32(offset + 20, true);
    const size = data.getUint32(offset + 24, true);
    const nameSize = data.getUint16(offset + 28, true);
    const next =
      offset +
      46 +
      nameSize +
      data.getUint16(offset + 30, true) +
      data.getUint16(offset + 32, true);
    if (next > end || flags & 1 || (method !== 0 && method !== 8))
      throw invalid();
    const name = strFromU8(bytes.subarray(offset + 46, offset + 46 + nameSize));
    if (
      !name ||
      name.startsWith('/') ||
      name.includes('\\') ||
      name.includes('//') ||
      name.split('/').includes('.') ||
      name.split('/').includes('..') ||
      names.has(name)
    )
      throw invalid();
    names.add(name);
    expanded += size;
    if (expanded > XLSX_MAX_EXPANDED_BYTES)
      throw new Error(
        `The expanded workbook exceeds the ${XLSX_MAX_EXPANDED_BYTES / 1024 / 1024} MB import limit.`
      );
    entries.push({
      name,
      size,
      compressed,
      method,
      offset: data.getUint32(offset + 42, true),
      crc: data.getUint32(offset + 16, true),
    });
    offset = next;
  }
  if (
    offset !== end ||
    !names.has('[Content_Types].xml') ||
    !names.has('xl/workbook.xml')
  )
    throw invalid();
  if ([...names].some((name) => /vbaProject\.bin$/i.test(name)))
    throw new Error(
      'Macro-enabled workbooks are not supported. Save a macro-free .xlsx copy first.'
    );
  return { entries, centralStart };
}

function inflateEntry(
  bytes: Uint8Array,
  entry: ArchiveEntry,
  centralStart: number
): Uint8Array {
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const local = entry.offset;
  if (local + 30 > centralStart || data.getUint32(local, true) !== 0x04034b50)
    throw invalid();
  const nameSize = data.getUint16(local + 26, true);
  const start = local + 30 + nameSize + data.getUint16(local + 28, true);
  if (
    start + entry.compressed > centralStart ||
    data.getUint16(local + 6, true) & 1 ||
    data.getUint16(local + 8, true) !== entry.method ||
    strFromU8(bytes.subarray(local + 30, local + 30 + nameSize)) !== entry.name
  )
    throw invalid();
  const compressed = bytes.subarray(start, start + entry.compressed);
  // One extra byte makes an understated ZIP size detectable without allowing
  // the inflater to allocate a buffer based on the deflate stream itself.
  let content: Uint8Array;
  try {
    content =
      entry.method === 0
        ? compressed
        : inflateSync(compressed, { out: new Uint8Array(entry.size + 1) });
  } catch {
    throw invalid();
  }
  if (content.length !== entry.size || crc32(content) !== entry.crc)
    throw invalid();
  return content;
}

/** Validate ZIP metadata and inflate every entry into fixed buffers. */
export function inspectXlsxArchive(bytes: Uint8Array) {
  const { entries, centralStart } = archiveEntries(bytes);
  const files: Record<string, Uint8Array> = Object.create(null);
  for (const entry of entries)
    files[entry.name] = inflateEntry(bytes, entry, centralStart);
  return { files };
}

export type XlsxArchive = {
  names: string[];
  /** Inflate one validated entry on demand; callers release it after use. */
  read: (name: string) => Uint8Array | undefined;
};

/** Validate the directory up front, then inflate entries only when read. */
export function openXlsxArchive(bytes: Uint8Array): XlsxArchive {
  const { entries, centralStart } = archiveEntries(bytes);
  const byName = new Map(entries.map((entry) => [entry.name, entry]));
  return {
    names: [...byName.keys()],
    read(name) {
      const entry = byName.get(name);
      return entry && inflateEntry(bytes, entry, centralStart);
    },
  };
}

/** Warnings for package parts Macro does not import, from entry names alone. */
export function xlsxFeatureWarnings(names: string[]): string[] {
  const warnings = new Set<string>();
  for (const name of names) {
    if (/^xl\/(charts|drawings|media)\//.test(name))
      warnings.add('Charts, drawings and images are not imported.');
    if (/^xl\/pivot/.test(name))
      warnings.add(
        'Pivot tables are not imported; existing cell values are retained.'
      );
    if (/^xl\/externalLinks\//.test(name))
      warnings.add(
        'External workbook links are not supported; formulas that use them keep their last calculated values.'
      );
    if (/^xl\/tables\//.test(name))
      warnings.add(
        'Excel tables are imported as ordinary cells; table formulas are converted to cell ranges.'
      );
  }
  return [...warnings];
}
