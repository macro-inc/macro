import { describe, expect, it } from 'vitest';
import {
  ARCHIVE_FORMAT,
  type ArchivedEntity,
  ArchiveFormatError,
  type ArchiveItem,
  asBufferSource,
  decodeArchive,
  encodeArchive,
} from './archive';
import { decodeTar, encodeTarEntry, TAR_END } from './tar';

const MANIFEST = {
  format: ARCHIVE_FORMAT,
  version: 1,
  exportedAt: '2026-11-02T12:00:00.000Z',
  exportedBy: 'user-1',
} as const;

async function* from<T>(items: T[]): AsyncGenerator<T> {
  yield* items;
}

async function bytesOf(stream: ReadableStream<Uint8Array>) {
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function streamOf(bytes: Uint8Array, chunk = bytes.length) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < bytes.length; i += chunk)
        controller.enqueue(bytes.slice(i, i + chunk));
      controller.close();
    },
  });
}

async function readAll(bytes: Uint8Array, chunk?: number) {
  const items: ArchiveItem[] = [];
  for await (const item of decodeArchive(streamOf(bytes, chunk)))
    items.push(item);
  return items;
}

function gzip(bytes: Uint8Array) {
  return bytesOf(
    asBufferSource(streamOf(bytes)).pipeThrough(new CompressionStream('gzip'))
  );
}

function tarOf(entries: { path: string; text: string }[]) {
  const parts: Uint8Array[] = [];
  for (const { path, text } of entries) {
    const { header, body, padding } = encodeTarEntry(
      { path, bytes: new TextEncoder().encode(text) },
      0
    );
    parts.push(header, body, padding);
  }
  parts.push(TAR_END);
  return new Uint8Array(parts.flatMap((part) => [...part]));
}

describe('workspace archive', () => {
  it('round-trips entities, binary files and failures losslessly', async () => {
    const binary = new Uint8Array(70_000);
    for (let i = 0; i < binary.length; i++) binary[i] = (i * 7919) % 256;
    const entities: ArchivedEntity[] = [
      {
        kind: 'project',
        id: 'p1',
        data: { name: 'Plans ✓', parentId: null, extra: { nested: [1, 2] } },
        files: [],
      },
      {
        kind: 'document',
        id: 'd1',
        data: { name: 'scan.pdf', projectId: 'p1' },
        files: [
          { name: 'content.pdf', bytes: binary },
          { name: 'empty.bin', bytes: new Uint8Array(0) },
        ],
      },
    ];
    const failures = [{ kind: 'email', id: 'e1', reason: 'not found' }];

    const archive = await bytesOf(
      encodeArchive(MANIFEST, from(entities), () => failures)
    );
    const items = await readAll(archive, 1013);

    expect(items).toEqual([
      { type: 'manifest', manifest: MANIFEST },
      { type: 'entity', entity: entities[0] },
      { type: 'entity', entity: entities[1] },
      {
        type: 'summary',
        summary: { entities: { project: 1, document: 1 }, failures },
      },
    ]);
  });

  it('compresses repetitive content', async () => {
    const text = new TextEncoder().encode('macro '.repeat(100_000));
    const archive = await bytesOf(
      encodeArchive(
        MANIFEST,
        from([
          {
            kind: 'document',
            id: 'd1',
            data: {},
            files: [{ name: 'content.md', bytes: text }],
          },
        ]),
        () => []
      )
    );
    expect(archive.length).toBeLessThan(text.length / 50);
  });

  it('is a standard tar.gz that other tools can list', async () => {
    const archive = await bytesOf(
      encodeArchive(
        MANIFEST,
        from([{ kind: 'document', id: 'd1', data: {}, files: [] }]),
        () => []
      )
    );
    const tar = asBufferSource(streamOf(archive)).pipeThrough(
      new DecompressionStream('gzip')
    );
    const paths: string[] = [];
    for await (const entry of decodeTar(tar)) paths.push(entry.path);
    expect(paths).toEqual([
      'manifest.json',
      'entities/document/d1/entity.json',
      'summary.json',
    ]);
  });

  it('reads version 1 archives written by hand, ignoring unknown fields and entries', async () => {
    const archive = await gzip(
      tarOf([
        {
          path: 'manifest.json',
          text: '{"format":"macro-workspace","version":1,"exportedAt":"2026-01-01T00:00:00Z","exportedBy":"u","future":true}',
        },
        { path: 'README.txt', text: 'added by a later exporter' },
        { path: 'entities/task/t1/content.md', text: '# Hi' },
        {
          path: 'entities/task/t1/entity.json',
          text: '{"kind":"task","id":"t1","files":["content.md"],"data":{"name":"Hi"},"later":1}',
        },
        { path: 'summary.json', text: '{"entities":{"task":1},"failures":[]}' },
      ])
    );
    const items = await readAll(archive);
    expect(items[0]).toEqual({
      type: 'manifest',
      manifest: {
        format: 'macro-workspace',
        version: 1,
        exportedAt: '2026-01-01T00:00:00Z',
        exportedBy: 'u',
      },
    });
    const entity = items[1].type === 'entity' ? items[1].entity : undefined;
    expect(entity?.data).toEqual({ name: 'Hi' });
    expect(entity?.files.map((file) => file.name)).toEqual(['content.md']);
    expect(new TextDecoder().decode(entity?.files[0].bytes)).toBe('# Hi');
    expect(items).toHaveLength(3);
  });

  it('refuses archives from a newer format version', async () => {
    const archive = await gzip(
      tarOf([
        {
          path: 'manifest.json',
          text: '{"format":"macro-workspace","version":2}',
        },
      ])
    );
    await expect(readAll(archive)).rejects.toMatchObject({
      reason: 'newer_version',
    });
  });

  it('rejects files that are not workspace archives', async () => {
    await expect(
      readAll(new TextEncoder().encode('not gzip at all'))
    ).rejects.toMatchObject({ reason: 'not_an_archive' });
    const otherTar = await gzip(tarOf([{ path: 'photo.jpg', text: 'x' }]));
    await expect(readAll(otherTar)).rejects.toMatchObject({
      reason: 'not_an_archive',
    });
  });

  it('rejects a truncated download', async () => {
    const archive = await bytesOf(
      encodeArchive(
        MANIFEST,
        from([
          {
            kind: 'document',
            id: 'd1',
            data: {},
            files: [{ name: 'a.bin', bytes: new Uint8Array(4096).fill(3) }],
          },
        ]),
        () => []
      )
    );
    const error = await readAll(archive.slice(0, archive.length - 20)).catch(
      (caught: unknown) => caught
    );
    expect(error).toBeInstanceOf(ArchiveFormatError);
    expect(error).toMatchObject({ reason: 'truncated' });
  });

  it('rejects an archive that lost its summary', async () => {
    const archive = await gzip(
      tarOf([
        {
          path: 'manifest.json',
          text: '{"format":"macro-workspace","version":1}',
        },
      ])
    );
    await expect(readAll(archive)).rejects.toMatchObject({
      reason: 'truncated',
    });
  });

  it('refuses unsafe entity paths when writing', async () => {
    const stream = encodeArchive(
      MANIFEST,
      from([{ kind: 'document', id: '../x', data: {}, files: [] }]),
      () => []
    );
    await expect(bytesOf(stream)).rejects.toBeInstanceOf(ArchiveFormatError);
  });
});
