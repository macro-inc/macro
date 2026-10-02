import { Inflate } from 'fflate';
import {
  type ArchiveDiscovery,
  ArchiveError,
  type ArchiveLimits,
  CONVERSATION_FILES,
  DEFAULT_ARCHIVE_LIMITS,
  parseDay,
  parseJson,
  resolveExport,
  validateArchiveLimits,
  validateArchivePath,
} from '../../../features/slack-import/core/export';

const SLICE_BYTES = 64 * 1024;
// A small compressed push bounds fflate's temporary expansion even for a ZIP bomb.
const INFLATE_BYTES = 1024;
const ROOT_FILES = new Set([
  ...Object.keys(CONVERSATION_FILES),
  'users.json',
  'org_users.json',
  'team.json',
]);
const DAY_PATH = /^[^/]+\/\d{4}-\d{2}-\d{2}\.json$/;

export type ArchiveDay = {
  path: string;
  slackChannelId: string;
  expandedBytes: number;
  records: Record<string, unknown>[];
};
type ZipEntry = {
  path: string;
  flags: number;
  method: number;
  crc: number;
  compressedBytes: number;
  expandedBytes: number;
  localOffset: number;
  dataOffset: number;
};

function checkCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new ArchiveError('cancelled');
}

async function yieldToCancellation(signal?: AbortSignal): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  checkCancelled(signal);
}

/** Bounded random-access slices; the ZIP itself is never materialized in memory. */
class ZipSlices {
  private offset = 0;
  private buffer = new Uint8Array(0);

  constructor(
    private readonly blob: Blob,
    private readonly signal?: AbortSignal
  ) {}

  async read(offset: number, length: number): Promise<Uint8Array> {
    checkCancelled(this.signal);
    if (offset < 0 || length < 0 || offset + length > this.blob.size)
      throw new ArchiveError('invalid_zip');
    if (
      offset < this.offset ||
      offset + length > this.offset + this.buffer.length
    ) {
      this.buffer = new Uint8Array(
        await this.blob
          .slice(offset, offset + Math.max(length, SLICE_BYTES))
          .arrayBuffer()
      );
      this.offset = offset;
      checkCancelled(this.signal);
    }
    return this.buffer.subarray(
      offset - this.offset,
      offset - this.offset + length
    );
  }
}

function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function decodePath(bytes: Uint8Array): string {
  try {
    const path = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    validateArchivePath(path);
    return path;
  } catch (error) {
    if (error instanceof ArchiveError) throw error;
    throw new ArchiveError('unsupported_zip');
  }
}

function checkExtra(bytes: Uint8Array): void {
  const data = view(bytes);
  for (let offset = 0; offset < bytes.length; ) {
    if (offset + 4 > bytes.length) throw new ArchiveError('invalid_zip');
    const kind = data.getUint16(offset, true);
    const size = data.getUint16(offset + 2, true);
    if (kind === 1) throw new ArchiveError('unsupported_zip');
    offset += 4 + size;
    if (offset > bytes.length) throw new ArchiveError('invalid_zip');
  }
}

type ZipDirectory = { offset: number; end: number; count: number };

async function readDirectoryLocation(
  blob: Blob,
  slices: ZipSlices,
  limits: ArchiveLimits
): Promise<ZipDirectory> {
  const tailOffset = Math.max(0, blob.size - 65557);
  const tail = await slices.read(tailOffset, blob.size - tailOffset);
  const end = view(tail);
  let eocd = tail.length - 22;
  while (
    eocd >= 0 &&
    (end.getUint32(eocd, true) !== 0x06054b50 ||
      eocd + 22 + end.getUint16(eocd + 20, true) !== tail.length)
  )
    eocd--;
  if (eocd < 0) throw new ArchiveError('invalid_zip');
  const count = end.getUint16(eocd + 10, true);
  const directoryBytes = end.getUint32(eocd + 12, true);
  const directoryOffset = end.getUint32(eocd + 16, true);
  if (
    end.getUint16(eocd + 4, true) !== 0 ||
    end.getUint16(eocd + 6, true) !== 0 ||
    end.getUint16(eocd + 8, true) !== count ||
    count === 65535 ||
    directoryBytes === 0xffffffff ||
    directoryOffset === 0xffffffff
  )
    throw new ArchiveError('unsupported_zip');
  if (count > limits.zipEntries) throw new ArchiveError('entry_limit');
  const directoryEnd = directoryOffset + directoryBytes;
  if (directoryEnd !== tailOffset + eocd) throw new ArchiveError('invalid_zip');
  return { offset: directoryOffset, end: directoryEnd, count };
}

async function readDirectoryEntries(
  slices: ZipSlices,
  directory: ZipDirectory,
  signal?: AbortSignal
): Promise<ZipEntry[]> {
  const { offset: directoryOffset, end: directoryEnd, count } = directory;
  const entries: ZipEntry[] = [];
  const paths = new Set<string>();
  let offset = directoryOffset;
  for (let i = 0; i < count; i++) {
    if (i % 128 === 0) await yieldToCancellation(signal);
    if (offset + 46 > directoryEnd) throw new ArchiveError('invalid_zip');
    const header = view(await slices.read(offset, 46));
    if (header.getUint32(0, true) !== 0x02014b50)
      throw new ArchiveError('invalid_zip');
    const flags = header.getUint16(8, true);
    const method = header.getUint16(10, true);
    const nameBytes = header.getUint16(28, true);
    const extraBytes = header.getUint16(30, true);
    const commentBytes = header.getUint16(32, true);
    const mode = (header.getUint32(38, true) >>> 16) & 0xf000;
    if (
      (flags & ~0x080e) !== 0 ||
      ![0, 8].includes(method) ||
      header.getUint16(6, true) > 20 ||
      header.getUint16(34, true) !== 0 ||
      ![0, 0x4000, 0x8000].includes(mode)
    )
      throw new ArchiveError('unsupported_zip');
    const nextOffset = offset + 46 + nameBytes + extraBytes + commentBytes;
    if (nextOffset > directoryEnd) throw new ArchiveError('invalid_zip');
    const path = decodePath(await slices.read(offset + 46, nameBytes));
    const canonicalPath = path.replace(/\/$/, '');
    if (paths.has(canonicalPath)) throw new ArchiveError('duplicate_entry');
    paths.add(canonicalPath);
    checkExtra(await slices.read(offset + 46 + nameBytes, extraBytes));
    const entry: ZipEntry = {
      path,
      flags,
      method,
      crc: header.getUint32(16, true),
      compressedBytes: header.getUint32(20, true),
      expandedBytes: header.getUint32(24, true),
      localOffset: header.getUint32(42, true),
      dataOffset: 0,
    };
    if (
      [entry.compressedBytes, entry.expandedBytes, entry.localOffset].includes(
        0xffffffff
      )
    )
      throw new ArchiveError('unsupported_zip');
    entries.push(entry);
    offset = nextOffset;
  }
  if (offset !== directoryEnd) throw new ArchiveError('invalid_zip');
  return entries;
}

async function validateLocalEntry(
  slices: ZipSlices,
  entry: ZipEntry,
  previousEnd: number,
  directoryOffset: number
): Promise<number> {
  if (
    entry.localOffset < previousEnd ||
    entry.localOffset + 30 > directoryOffset
  )
    throw new ArchiveError('invalid_zip');
  const header = view(await slices.read(entry.localOffset, 30));
  const nameBytes = header.getUint16(26, true);
  const extraBytes = header.getUint16(28, true);
  if (
    header.getUint32(0, true) !== 0x04034b50 ||
    header.getUint16(4, true) > 20 ||
    header.getUint16(6, true) !== entry.flags ||
    header.getUint16(8, true) !== entry.method
  )
    throw new ArchiveError('invalid_zip');
  entry.dataOffset = entry.localOffset + 30 + nameBytes + extraBytes;
  previousEnd = entry.dataOffset + entry.compressedBytes;
  if (previousEnd > directoryOffset) throw new ArchiveError('invalid_zip');
  if (
    decodePath(await slices.read(entry.localOffset + 30, nameBytes)) !==
    entry.path
  )
    throw new ArchiveError('invalid_zip');
  checkExtra(await slices.read(entry.localOffset + 30 + nameBytes, extraBytes));
  if (entry.flags & 8) {
    if (previousEnd + 12 > directoryOffset)
      throw new ArchiveError('invalid_zip');
    const signature = view(await slices.read(previousEnd, 4)).getUint32(
      0,
      true
    );
    if (signature === 0x08074b50) previousEnd += 4;
    if (previousEnd + 12 > directoryOffset)
      throw new ArchiveError('invalid_zip');
    const descriptor = view(await slices.read(previousEnd, 12));
    if (
      descriptor.getUint32(0, true) !== entry.crc ||
      descriptor.getUint32(4, true) !== entry.compressedBytes ||
      descriptor.getUint32(8, true) !== entry.expandedBytes
    )
      throw new ArchiveError('invalid_zip');
    previousEnd += 12;
  } else if (
    header.getUint32(14, true) !== entry.crc ||
    header.getUint32(18, true) !== entry.compressedBytes ||
    header.getUint32(22, true) !== entry.expandedBytes
  )
    throw new ArchiveError('invalid_zip');
  return previousEnd;
}

/** Index central/local headers, never inflate messages or ignored attachment files. */
async function indexZip(
  blob: Blob,
  limits: ArchiveLimits,
  signal?: AbortSignal
): Promise<ZipEntry[]> {
  const slices = new ZipSlices(blob, signal);
  const directory = await readDirectoryLocation(blob, slices, limits);
  const entries = await readDirectoryEntries(slices, directory, signal);
  // Reject overlapping data and local/central disagreement before showing a picker.
  entries.sort((a, b) => a.localOffset - b.localOffset);
  let previousEnd = 0;
  for (const [index, entry] of entries.entries()) {
    if (index % 128 === 0) await yieldToCancellation(signal);
    previousEnd = await validateLocalEntry(
      slices,
      entry,
      previousEnd,
      directory.offset
    );
  }
  return entries;
}

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++)
    value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  return value;
});

async function readJsonEntry(
  blob: Blob,
  entry: ZipEntry,
  limits: ArchiveLimits,
  account: (bytes: number) => void,
  signal?: AbortSignal
): Promise<Uint8Array> {
  if (entry.expandedBytes > limits.jsonBytes)
    throw new ArchiveError('json_limit');
  // Deflate may retain unconsumed input (e.g. padding after an end marker).
  // Bound compressed input too, with generous room for compression overhead.
  if (entry.compressedBytes > limits.jsonBytes * 2 + SLICE_BYTES)
    throw new ArchiveError('compressed_limit');
  const chunks: Uint8Array[] = [];
  let length = 0;
  let crc = 0xffffffff;
  function receive(chunk: Uint8Array): void {
    length += chunk.length;
    if (length > limits.jsonBytes) throw new ArchiveError('json_limit');
    account(chunk.length);
    for (const byte of chunk) crc = CRC_TABLE[(crc ^ byte) & 255] ^ (crc >>> 8);
    if (chunk.length) chunks.push(chunk.slice());
  }
  const inflate = entry.method === 8 ? new Inflate(receive) : undefined;
  const slices = new ZipSlices(blob, signal);
  try {
    for (
      let offset = 0;
      offset < entry.compressedBytes;
      offset += SLICE_BYTES
    ) {
      await yieldToCancellation(signal);
      const chunk = await slices.read(
        entry.dataOffset + offset,
        Math.min(SLICE_BYTES, entry.compressedBytes - offset)
      );
      if (!inflate) receive(chunk);
      else {
        for (let inner = 0; inner < chunk.length; inner += INFLATE_BYTES) {
          const end = Math.min(inner + INFLATE_BYTES, chunk.length);
          inflate.push(
            chunk.subarray(inner, end),
            offset + end === entry.compressedBytes
          );
        }
      }
    }
    if (inflate && entry.compressedBytes === 0)
      inflate.push(new Uint8Array(), true);
  } catch (error) {
    if (error instanceof ArchiveError) throw error;
    throw new ArchiveError('invalid_zip');
  }
  if (length !== entry.expandedBytes || (crc ^ 0xffffffff) >>> 0 !== entry.crc)
    throw new ArchiveError('invalid_zip');
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

/** Holds only bounded metadata and ZIP indices between passes, never history. */
export class ArchiveReader {
  private discovery: ArchiveDiscovery | undefined;
  private entries: ZipEntry[] = [];
  private metadataBytes = 0;
  private started = false;
  private historyStarted = false;

  constructor(
    private readonly blob: Blob,
    private readonly limits: ArchiveLimits = DEFAULT_ARCHIVE_LIMITS
  ) {
    validateArchiveLimits(limits);
  }

  async discover(signal?: AbortSignal): Promise<ArchiveDiscovery> {
    if (this.started) throw new ArchiveError('invalid_state');
    this.started = true;
    this.entries = await indexZip(this.blob, this.limits, signal);
    const roots = new Map<string, unknown>();
    const dayPaths: string[] = [];
    for (const entry of this.entries) {
      if (ROOT_FILES.has(entry.path)) {
        const bytes = await readJsonEntry(
          this.blob,
          entry,
          this.limits,
          (size) => {
            this.metadataBytes += size;
            if (this.metadataBytes > this.limits.selectedBytes)
              throw new ArchiveError('selected_limit');
          },
          signal
        );
        roots.set(entry.path, parseJson(bytes));
      } else if (DAY_PATH.test(entry.path)) dayPaths.push(entry.path);
      else if (
        /\/\d{4}-\d{2}-\d{2}\.json$/.test(entry.path) &&
        !entry.path.startsWith('__MACOSX/')
      ) {
        // Nested/unknown history layouts must not silently become empty imports.
        throw new ArchiveError('unresolved_folder');
      }
    }
    this.discovery = resolveExport(roots, dayPaths);
    const usersBytes = new TextEncoder().encode(
      JSON.stringify(this.discovery.users)
    ).length;
    if (usersBytes > this.limits.jsonBytes)
      throw new ArchiveError('json_limit');
    checkCancelled(signal);
    return this.discovery;
  }

  /** One pass across ALL selected folders; awaiting the consumer provides backpressure. */
  async *readHistory(
    selectedIds: readonly string[],
    includeMessageHistory: boolean,
    signal?: AbortSignal
  ): AsyncGenerator<ArchiveDay> {
    checkCancelled(signal);
    if (!this.discovery || this.historyStarted)
      throw new ArchiveError('invalid_state');
    const selected = new Set(selectedIds);
    const known = new Set(
      this.discovery.conversations.map((item) => item.slackChannelId)
    );
    if (
      !selected.size ||
      selected.size !== selectedIds.length ||
      selected.size > this.limits.conversations ||
      [...selected].some((id) => !known.has(id))
    )
      throw new ArchiveError('invalid_selection');
    this.historyStarted = true;
    if (!includeMessageHistory) return;
    const days = new Map(
      this.discovery.dayEntries
        .filter((day) => selected.has(day.slackChannelId))
        .map((day) => [day.path, day.slackChannelId])
    );
    let selectedBytes = this.metadataBytes;
    for (const entry of this.entries) {
      const slackChannelId = days.get(entry.path);
      if (!slackChannelId) continue;
      const bytes = await readJsonEntry(
        this.blob,
        entry,
        this.limits,
        (size) => {
          selectedBytes += size;
          if (selectedBytes > this.limits.selectedBytes)
            throw new ArchiveError('selected_limit');
        },
        signal
      );
      yield {
        path: entry.path,
        slackChannelId,
        expandedBytes: bytes.length,
        records: parseDay(bytes),
      };
      checkCancelled(signal);
    }
  }
}
