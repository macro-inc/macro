import { decodeTar, encodeTarEntry, TAR_END, TarError } from './tar';

/**
 * A workspace archive is a gzip-compressed tar (`.macro.tar.gz`):
 *
 *   manifest.json                    always first: format, version, exporter
 *   entities/<kind>/<id>/<file>      an entity's content files, then
 *   entities/<kind>/<id>/entity.json its record, which closes the entity
 *   summary.json                     always last: counts and export failures
 *
 * Compatibility rules, which every reader and writer keeps:
 * - `version` changes only when an old reader would misread a new archive.
 *   Readers refuse versions above their own and read every version below.
 * - New fields and new entity kinds never bump the version: readers ignore
 *   fields they don't know and report kinds they can't import as skipped.
 * - `entity.data` is the service's own response, stored verbatim, so an
 *   archive keeps fields this app doesn't model yet.
 */
export const ARCHIVE_FORMAT = 'macro-workspace';
export const ARCHIVE_VERSION = 1;

export type ArchiveManifest = {
  format: typeof ARCHIVE_FORMAT;
  version: number;
  exportedAt: string;
  exportedBy: string;
};

export type ArchiveFile = { name: string; bytes: Uint8Array };

export type ArchivedEntity = {
  kind: string;
  id: string;
  /** Verbatim service response describing the entity. */
  data: unknown;
  files: ArchiveFile[];
};

export type ArchiveFailure = { kind: string; id: string; reason: string };

export type ArchiveSummary = {
  entities: Record<string, number>;
  failures: ArchiveFailure[];
};

export type ArchiveItem =
  | { type: 'manifest'; manifest: ArchiveManifest }
  | { type: 'entity'; entity: ArchivedEntity }
  | { type: 'summary'; summary: ArchiveSummary };

export class ArchiveFormatError extends Error {
  constructor(
    readonly reason:
      | 'not_an_archive'
      | 'newer_version'
      | 'corrupt'
      | 'truncated',
    message: string
  ) {
    super(message);
    this.name = 'ArchiveFormatError';
  }
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const SAFE_SEGMENT = /^[A-Za-z0-9_.-]{1,64}$/;

function json(value: unknown): Uint8Array {
  return encoder.encode(JSON.stringify(value));
}

function entityPath(kind: string, id: string, name: string): string {
  for (const segment of [kind, id, name]) {
    if (!SAFE_SEGMENT.test(segment) || segment === '.' || segment === '..')
      throw new ArchiveFormatError(
        'corrupt',
        `Unsafe archive path segment: ${segment}`
      );
  }
  return `entities/${kind}/${id}/${name}`;
}

/** Serializes a workspace into a gzip-compressed tar stream. */
export function encodeArchive(
  manifest: ArchiveManifest,
  entities: AsyncIterable<ArchivedEntity>,
  failures: () => ArchiveFailure[]
): ReadableStream<Uint8Array> {
  const mtime = Date.parse(manifest.exportedAt) / 1000;
  async function* blocks(): AsyncGenerator<Uint8Array> {
    function* entry(path: string, bytes: Uint8Array) {
      const { header, body, padding } = encodeTarEntry({ path, bytes }, mtime);
      yield header;
      if (body.length > 0) yield body;
      if (padding.length > 0) yield padding;
    }
    yield* entry('manifest.json', json(manifest));
    const counts: Record<string, number> = {};
    for await (const entity of entities) {
      const names = new Set<string>();
      for (const file of entity.files) {
        if (file.name === 'entity.json' || names.has(file.name))
          throw new ArchiveFormatError(
            'corrupt',
            `Duplicate file ${file.name} in ${entity.kind}/${entity.id}`
          );
        names.add(file.name);
        yield* entry(entityPath(entity.kind, entity.id, file.name), file.bytes);
      }
      const record = {
        kind: entity.kind,
        id: entity.id,
        files: [...names],
        data: entity.data,
      };
      yield* entry(
        entityPath(entity.kind, entity.id, 'entity.json'),
        json(record)
      );
      counts[entity.kind] = (counts[entity.kind] ?? 0) + 1;
    }
    const summary: ArchiveSummary = { entities: counts, failures: failures() };
    yield* entry('summary.json', json(summary));
    yield TAR_END;
  }

  const iterator = blocks();
  const tar = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const next = await iterator.next();
      if (next.done) controller.close();
      else controller.enqueue(next.value);
    },
    async cancel(reason) {
      await iterator.throw(reason);
    },
  });
  return asBufferSource(tar).pipeThrough(new CompressionStream('gzip'));
}

/**
 * Re-types a byte stream for the native compression streams, whose writable
 * side accepts any `BufferSource`. Pulls lazily, so backpressure holds.
 */
export function asBufferSource(
  source: ReadableStream<Uint8Array>
): ReadableStream<BufferSource> {
  const reader = source.getReader();
  return new ReadableStream<BufferSource>({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) controller.close();
      else
        controller.enqueue(
          value.buffer instanceof ArrayBuffer
            ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
            : value.slice()
        );
    },
    cancel: (reason) => reader.cancel(reason),
  });
}

function parseJson(bytes: Uint8Array, path: string): unknown {
  try {
    return JSON.parse(decoder.decode(bytes));
  } catch {
    throw new ArchiveFormatError('corrupt', `Unreadable ${path}`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toManifest(value: unknown): ArchiveManifest {
  if (!isRecord(value) || value.format !== ARCHIVE_FORMAT)
    throw new ArchiveFormatError(
      'not_an_archive',
      'This file is not a Macro workspace archive'
    );
  if (typeof value.version !== 'number' || !Number.isInteger(value.version))
    throw new ArchiveFormatError('corrupt', 'Archive version is missing');
  if (value.version > ARCHIVE_VERSION)
    throw new ArchiveFormatError(
      'newer_version',
      `Archive version ${value.version} needs a newer Macro`
    );
  return {
    format: ARCHIVE_FORMAT,
    version: value.version,
    exportedAt: typeof value.exportedAt === 'string' ? value.exportedAt : '',
    exportedBy: typeof value.exportedBy === 'string' ? value.exportedBy : '',
  };
}

function toSummary(value: unknown): ArchiveSummary {
  if (!isRecord(value)) return { entities: {}, failures: [] };
  const entities: Record<string, number> = {};
  if (isRecord(value.entities)) {
    for (const [kind, count] of Object.entries(value.entities)) {
      if (typeof count === 'number') entities[kind] = count;
    }
  }
  const failures = Array.isArray(value.failures)
    ? value.failures.filter(
        (failure): failure is ArchiveFailure =>
          isRecord(failure) &&
          typeof failure.kind === 'string' &&
          typeof failure.id === 'string' &&
          typeof failure.reason === 'string'
      )
    : [];
  return { entities, failures };
}

/** Joins an entity record with the files written before it. */
function toEntity(
  kind: string,
  id: string,
  record: unknown,
  pending: ReadonlyMap<string, Uint8Array>
): ArchivedEntity {
  if (!isRecord(record))
    throw new ArchiveFormatError(
      'corrupt',
      `Unreadable record for ${kind}/${id}`
    );
  const names = Array.isArray(record.files)
    ? record.files.filter((file): file is string => typeof file === 'string')
    : [];
  const files = names.map((name) => {
    const bytes = pending.get(name);
    if (!bytes)
      throw new ArchiveFormatError(
        'corrupt',
        `Missing ${name} for ${kind}/${id}`
      );
    return { name, bytes };
  });
  return { kind, id, data: record.data, files };
}

/**
 * Reads an archive as a stream: one entity at a time is held in memory, so
 * archives larger than memory import. Gzip's CRC rejects corrupted bytes,
 * and a missing `summary.json` rejects a truncated download.
 */
export async function* decodeArchive(
  compressed: ReadableStream<Uint8Array>
): AsyncGenerator<ArchiveItem> {
  const tar = asBufferSource(compressed).pipeThrough(
    new DecompressionStream('gzip')
  );
  let sawManifest = false;
  let sawSummary = false;
  let pending = new Map<string, Uint8Array>();
  let pendingEntity: string | undefined;

  try {
    for await (const { path, bytes } of decodeTar(tar)) {
      if (!sawManifest) {
        if (path !== 'manifest.json')
          throw new ArchiveFormatError(
            'not_an_archive',
            'This file is not a Macro workspace archive'
          );
        sawManifest = true;
        yield {
          type: 'manifest',
          manifest: toManifest(parseJson(bytes, path)),
        };
        continue;
      }
      if (sawSummary) continue;
      if (path === 'summary.json') {
        sawSummary = true;
        yield { type: 'summary', summary: toSummary(parseJson(bytes, path)) };
        continue;
      }

      const parts = path.split('/');
      if (parts.length !== 4 || parts[0] !== 'entities') continue;
      const [, kind, id, name] = parts;
      const entityKey = `${kind}/${id}`;
      if (pendingEntity !== entityKey) {
        pending = new Map();
        pendingEntity = entityKey;
      }
      if (name !== 'entity.json') {
        pending.set(name, bytes);
        continue;
      }

      const entity = toEntity(kind, id, parseJson(bytes, path), pending);
      pending = new Map();
      pendingEntity = undefined;
      yield { type: 'entity', entity };
    }
  } catch (error) {
    if (error instanceof ArchiveFormatError) throw error;
    if (error instanceof TarError)
      throw new ArchiveFormatError('corrupt', error.message);
    // DecompressionStream rejects with a TypeError on bad gzip data.
    throw new ArchiveFormatError(
      sawManifest ? 'truncated' : 'not_an_archive',
      sawManifest
        ? 'The archive is damaged or incomplete'
        : 'This file is not a Macro workspace archive'
    );
  }
  if (!sawManifest)
    throw new ArchiveFormatError(
      'not_an_archive',
      'This file is not a Macro workspace archive'
    );
  if (!sawSummary)
    throw new ArchiveFormatError(
      'truncated',
      'The archive is incomplete; export it again'
    );
}
