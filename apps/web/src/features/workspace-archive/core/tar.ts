/**
 * Minimal POSIX ustar, the container inside a workspace archive. Tar streams
 * in both directions with no entry-count or archive-size ceiling, and every
 * operating system opens a `.tar.gz` without extra software.
 */

const BLOCK = 512;
const NAME_BYTES = 100;
// Eleven octal digits: the ustar size field's largest value, 8 GiB - 1.
const MAX_SIZE = 0o77777777777;

export type TarEntry = { path: string; bytes: Uint8Array };

export class TarError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TarError';
  }
}

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

function writeOctal(
  header: Uint8Array,
  offset: number,
  width: number,
  value: number
) {
  const digits = value.toString(8).padStart(width - 1, '0');
  header.set(encoder.encode(digits), offset);
  header[offset + width - 1] = 0;
}

function checksum(header: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < BLOCK; i++) {
    sum += i >= 148 && i < 156 ? 0x20 : header[i];
  }
  return sum;
}

/** The header block and padded body of one regular file. */
export function encodeTarEntry(entry: TarEntry, mtimeSeconds: number) {
  const name = encoder.encode(entry.path);
  if (name.length === 0 || name.length > NAME_BYTES)
    throw new TarError(`Archive path is empty or too long: ${entry.path}`);
  if (entry.bytes.length > MAX_SIZE)
    throw new TarError(`Archive entry is too large: ${entry.path}`);

  const header = new Uint8Array(BLOCK);
  header.set(name, 0);
  writeOctal(header, 100, 8, 0o644);
  writeOctal(header, 108, 8, 0);
  writeOctal(header, 116, 8, 0);
  writeOctal(header, 124, 12, entry.bytes.length);
  writeOctal(header, 136, 12, Math.max(0, Math.floor(mtimeSeconds)));
  header[156] = 0x30; // '0': regular file
  header.set(encoder.encode('ustar\u000000'), 257);
  const sum = checksum(header).toString(8).padStart(6, '0');
  header.set(encoder.encode(`${sum}\u0000 `), 148);

  const padding = (BLOCK - (entry.bytes.length % BLOCK)) % BLOCK;
  return { header, body: entry.bytes, padding: new Uint8Array(padding) };
}

/** Two zero blocks end a tar stream. */
export const TAR_END = new Uint8Array(BLOCK * 2);

function readOctal(header: Uint8Array, offset: number, width: number) {
  const field = header.subarray(offset, offset + width);
  const end = field.findIndex((byte) => byte === 0 || byte === 0x20);
  const text = decoder.decode(field.subarray(0, end === -1 ? width : end));
  if (!/^[0-7]*$/.test(text)) throw new TarError('Corrupt archive header');
  return text === '' ? 0 : Number.parseInt(text, 8);
}

/** Reads exact byte counts from a stream of arbitrarily sized chunks. */
class ByteReader {
  private chunks: Uint8Array[] = [];
  private buffered = 0;

  constructor(
    private readonly reader: ReadableStreamDefaultReader<Uint8Array>
  ) {}

  /** `null` only when the stream ends before any of the bytes arrive. */
  async read(length: number): Promise<Uint8Array | null> {
    while (this.buffered < length) {
      const { done, value } = await this.reader.read();
      if (done) {
        if (this.buffered === 0) return null;
        throw new TarError('Archive ends unexpectedly');
      }
      this.chunks.push(value);
      this.buffered += value.length;
    }
    const out = new Uint8Array(length);
    let filled = 0;
    while (filled < length) {
      const chunk = this.chunks[0];
      const take = Math.min(chunk.length, length - filled);
      out.set(chunk.subarray(0, take), filled);
      filled += take;
      if (take === chunk.length) this.chunks.shift();
      else this.chunks[0] = chunk.subarray(take);
    }
    this.buffered -= length;
    return out;
  }
}

/**
 * Yields each regular file in a tar stream, checking header checksums.
 * Directories and metadata entries are skipped, so archives repacked by
 * other tools still read.
 */
export async function* decodeTar(
  stream: ReadableStream<Uint8Array>
): AsyncGenerator<TarEntry> {
  const reader = stream.getReader();
  const bytes = new ByteReader(reader);
  try {
    for (;;) {
      const header = await bytes.read(BLOCK);
      if (header === null || header.every((byte) => byte === 0)) return;
      if (readOctal(header, 148, 8) !== checksum(header))
        throw new TarError('Corrupt archive header');

      const size = readOctal(header, 124, 12);
      const body = (await bytes.read(size)) ?? new Uint8Array(0);
      const padding = (BLOCK - (size % BLOCK)) % BLOCK;
      if (padding > 0) await bytes.read(padding);

      const type = header[156];
      if (type !== 0x30 && type !== 0) continue;
      const nameEnd = header.indexOf(0);
      const name = decoder.decode(
        header.subarray(
          0,
          nameEnd === -1 || nameEnd > NAME_BYTES ? NAME_BYTES : nameEnd
        )
      );
      const prefixField = header.subarray(345, 500);
      const prefixEnd = prefixField.indexOf(0);
      const prefix = decoder.decode(
        prefixField.subarray(
          0,
          prefixEnd === -1 ? prefixField.length : prefixEnd
        )
      );
      yield { path: prefix ? `${prefix}/${name}` : name, bytes: body };
    }
  } finally {
    reader.releaseLock();
  }
}
