// @vitest-environment node
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ARCHIVE_LIMITS } from '../../../features/slack-import/core/export';
import type {
  ArchiveWorkerPort,
  ArchiveWorkerRequest,
  ArchiveWorkerResponse,
} from '../../../features/slack-import/core/worker-protocol';
import {
  corporateEntries,
  enterpriseEntries,
  MESSAGE,
  patchEntry,
  standardEntries,
  streamingZipFixture,
  zipBlob,
  zipFixture,
} from '../../../features/slack-import/tests/zip-fixtures';
import { type ArchiveDay, ArchiveReader } from './archive-reader';
import { installArchiveWorker } from './unzip-worker';
import { createSlackImportWorker } from './worker-client';

async function collect(
  reader: ArchiveReader,
  ids: string[],
  history = true
): Promise<ArchiveDay[]> {
  const days = [];
  for await (const day of reader.readHistory(ids, history)) days.push(day);
  return days;
}

function workerHarness(): {
  messages: ArchiveWorkerResponse[];
  send(request: ArchiveWorkerRequest): void;
  wait(type: ArchiveWorkerResponse['type']): Promise<void>;
} {
  const messages: ArchiveWorkerResponse[] = [];
  const port: ArchiveWorkerPort = {
    postMessage: (message) => messages.push(message),
    onmessage: null,
  };
  installArchiveWorker(port);
  return {
    messages,
    send(request: ArchiveWorkerRequest): void {
      port.onmessage?.({ data: request } as MessageEvent<ArchiveWorkerRequest>);
    },
    async wait(type: ArchiveWorkerResponse['type']): Promise<void> {
      await vi.waitFor(() =>
        expect(messages.some((message) => message.type === type)).toBe(true)
      );
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('bounded ZIP reader', () => {
  it.each([standardEntries, corporateEntries, enterpriseEntries])(
    'discovers and parses supported export roots',
    async (entries) => {
      const reader = new ArchiveReader(zipBlob(zipFixture(entries())));
      const discovery = await reader.discover();
      expect(
        discovery.conversations.every((item) => item.messageCount === null)
      ).toBe(true);
      const days = await collect(
        reader,
        discovery.conversations.map((item) => item.slackChannelId)
      );
      expect(days).toHaveLength(discovery.dayEntries.length);
      expect(days.every((day) => day.records[0].ts === MESSAGE.ts)).toBe(true);
    }
  );

  it('supports streaming ZIP data descriptors and rejects descriptor conflicts', async () => {
    const bytes = streamingZipFixture(standardEntries());
    const reader = new ArchiveReader(zipBlob(bytes));
    await reader.discover();
    expect(await collect(reader, ['C100'])).toHaveLength(1);
    const forged = patchEntry(bytes, 'users.json', (header, central) => {
      if (central) header.setUint32(24, 1, true);
    });
    await expect(
      new ArchiveReader(zipBlob(forged)).discover()
    ).rejects.toMatchObject({ code: 'invalid_zip' });
  });

  it('uses bounded Blob slices across large central directories and day files', async () => {
    const entries = standardEntries();
    entries['general/2023-11-14.json'] = [
      { ...MESSAGE, text: 'x'.repeat(200_000) },
    ];
    for (let i = 0; i < 1500; i++)
      entries[`files/attachment-${i}.bin`] = 'ignored';
    const blob = zipBlob(zipFixture(entries, false));
    const slice = vi.spyOn(blob, 'slice');
    const readWholeArchive = vi.spyOn(blob, 'arrayBuffer');
    const reader = new ArchiveReader(blob);
    await reader.discover();
    expect(await collect(reader, ['C100'])).toHaveLength(1);
    expect(readWholeArchive).not.toHaveBeenCalled();
    expect(
      slice.mock.calls.every(
        ([start, end]) => (end ?? 0) - (start ?? 0) <= 65557
      )
    ).toBe(true);
  });

  it('does not parse any history or make a network/upload request during discovery', async () => {
    const fetch = vi.fn(() => {
      throw new Error('No network allowed');
    });
    vi.stubGlobal('fetch', fetch);
    vi.stubGlobal(
      'XMLHttpRequest',
      vi.fn(() => {
        throw new Error('No uploads allowed');
      })
    );
    const reader = new ArchiveReader(
      zipBlob(
        zipFixture({
          ...standardEntries(),
          'general/2023-11-14.json': 'not JSON',
        })
      )
    );
    const discovery = await reader.discover();
    expect(discovery.conversations[0].messageCount).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    expect(XMLHttpRequest).not.toHaveBeenCalled();
    await expect(collect(reader, ['C100'])).rejects.toMatchObject({
      code: 'invalid_json',
    });
  });

  it('shape-only skips malformed/oversized history entirely', async () => {
    const reader = new ArchiveReader(
      zipBlob(
        zipFixture({
          ...standardEntries(),
          'general/2023-11-14.json': 'x'.repeat(4000),
        })
      ),
      { ...DEFAULT_ARCHIVE_LIMITS, jsonBytes: 1024 }
    );
    await reader.discover();
    expect(await collect(reader, ['C100'], false)).toEqual([]);
  });

  it('supports metadata-only conversations with empty history', async () => {
    const entries = standardEntries();
    delete entries['general/2023-11-14.json'];
    const reader = new ArchiveReader(zipBlob(zipFixture(entries)));
    const discovery = await reader.discover();
    expect(discovery.conversations[0].messageCount).toBeNull();
    expect(await collect(reader, ['C100'])).toEqual([]);
  });

  it('bounds compressed input as well as output, even with forged original sizes', async () => {
    const path = 'general/2023-11-14.json';
    const bytes = patchEntry(
      zipFixture({ ...standardEntries(), [path]: 'x'.repeat(100_000) }, false),
      path,
      (header, central) => header.setUint32(central ? 24 : 22, 1, true)
    );
    const reader = new ArchiveReader(zipBlob(bytes), {
      ...DEFAULT_ARCHIVE_LIMITS,
      jsonBytes: 1024,
    });
    await reader.discover();
    await expect(collect(reader, ['C100'])).rejects.toMatchObject({
      code: 'compressed_limit',
    });
  });

  it('reads all selected folders together once, skipping unselected bodies', async () => {
    const entries = corporateEntries();
    entries['private/2023-11-15.json'] = [
      { ...MESSAGE, ts: '1700000000.000002' },
    ];
    entries['mpdm-example/2023-11-14.json'] = 'malformed, but not selected';
    const reader = new ArchiveReader(zipBlob(zipFixture(entries, false)));
    await reader.discover();
    const days = await collect(reader, ['C200', 'D100']);
    expect(days.map((day) => day.slackChannelId)).toEqual([
      'C200',
      'D100',
      'C200',
    ]);
    await expect(collect(reader, ['C200'])).rejects.toMatchObject({
      code: 'invalid_state',
    });
  });

  it('does not inflate attachment bytes', async () => {
    const bytes = zipFixture({
      ...standardEntries(),
      'files/ignored.bin': 'x'.repeat(200_000),
    });
    const reader = new ArchiveReader(zipBlob(bytes), {
      ...DEFAULT_ARCHIVE_LIMITS,
      jsonBytes: 1024,
    });
    await reader.discover();
    expect(await collect(reader, ['C100'])).toHaveLength(1);
  });

  it.each([
    '../users.json',
    '/root.json',
    'general/../day.json',
    'general\\2020-01-01.json',
  ])('rejects unsafe ZIP paths %s', async (path) => {
    const reader = new ArchiveReader(
      zipBlob(zipFixture({ ...standardEntries(), [path]: [] }))
    );
    await expect(reader.discover()).rejects.toMatchObject({
      code: 'unsafe_path',
    });
  });

  it('rejects conflicting duplicate ZIP entries, including local names', async () => {
    const bytes = patchEntry(
      zipFixture({ ...standardEntries(), 'other.json': [1] }),
      'other.json',
      (header, central) => {
        const start = central ? 46 : 30;
        for (const [i, byte] of new TextEncoder()
          .encode('users.json')
          .entries())
          header.setUint8(start + i, byte);
      }
    );
    await expect(
      new ArchiveReader(zipBlob(bytes)).discover()
    ).rejects.toMatchObject({ code: 'duplicate_entry' });
  });

  it.each([
    [
      'encrypted',
      (header: DataView, central: boolean) =>
        header.setUint16(central ? 8 : 6, 1, true),
    ],
    [
      'unsupported compression',
      (header: DataView, central: boolean) =>
        header.setUint16(central ? 10 : 8, 99, true),
    ],
    [
      'ZIP64',
      (header: DataView, central: boolean) =>
        header.setUint16(central ? 6 : 4, 45, true),
    ],
    [
      'symlink',
      (header: DataView, central: boolean) => {
        if (central) header.setUint32(38, 0xa0000000, true);
      },
    ],
  ] as const)('rejects %s archives', async (_, patch) => {
    const bytes = patchEntry(
      zipFixture(standardEntries()),
      'users.json',
      patch
    );
    await expect(
      new ArchiveReader(zipBlob(bytes)).discover()
    ).rejects.toMatchObject({ code: 'unsupported_zip' });
  });

  it('rejects truncated ZIPs, CRC corruption and local/central inconsistencies', async () => {
    const valid = zipFixture(standardEntries());
    await expect(
      new ArchiveReader(zipBlob(valid.slice(0, -1))).discover()
    ).rejects.toMatchObject({ code: 'invalid_zip' });
    const badCrc = patchEntry(valid, 'users.json', (header, central) =>
      header.setUint32(central ? 16 : 14, 0, true)
    );
    await expect(
      new ArchiveReader(zipBlob(badCrc)).discover()
    ).rejects.toMatchObject({ code: 'invalid_zip' });
    const badLocal = patchEntry(valid, 'users.json', (header, central) => {
      if (!central) header.setUint16(8, 99, true);
    });
    await expect(
      new ArchiveReader(zipBlob(badLocal)).discover()
    ).rejects.toMatchObject({ code: 'invalid_zip' });
  });

  it('rejects missing metadata and unresolved/nested history instead of silently omitting it', async () => {
    await expect(
      new ArchiveReader(zipBlob(zipFixture({ 'users.json': [] }))).discover()
    ).rejects.toMatchObject({ code: 'missing_metadata' });
    await expect(
      new ArchiveReader(
        zipBlob(
          zipFixture({ ...standardEntries(), 'unknown/2020-01-01.json': [] })
        )
      ).discover()
    ).rejects.toMatchObject({ code: 'unresolved_folder' });
    await expect(
      new ArchiveReader(
        zipBlob(
          zipFixture({
            ...standardEntries(),
            'team/general/2020-01-01.json': [],
          })
        )
      ).discover()
    ).rejects.toMatchObject({ code: 'unresolved_folder' });
  });

  it('enforces entry and selection limits', async () => {
    await expect(
      new ArchiveReader(zipBlob(zipFixture(standardEntries())), {
        ...DEFAULT_ARCHIVE_LIMITS,
        zipEntries: 2,
      }).discover()
    ).rejects.toMatchObject({ code: 'entry_limit' });
    for (const ids of [[], ['missing'], ['C100', 'C100']]) {
      const reader = new ArchiveReader(zipBlob(zipFixture(standardEntries())));
      await reader.discover();
      await expect(collect(reader, ids)).rejects.toMatchObject({
        code: 'invalid_selection',
      });
    }
    const reader = new ArchiveReader(zipBlob(zipFixture(corporateEntries())), {
      ...DEFAULT_ARCHIVE_LIMITS,
      conversations: 1,
    });
    await reader.discover();
    await expect(collect(reader, ['C200', 'D100'])).rejects.toMatchObject({
      code: 'invalid_selection',
    });
  });

  it('applies actual expanded-byte limits to metadata and day ZIP bombs with forged sizes', async () => {
    for (const path of ['users.json', 'general/2023-11-14.json']) {
      const bytes = patchEntry(
        zipFixture({ ...standardEntries(), [path]: 'x'.repeat(2_000_000) }),
        path,
        (header, central) => header.setUint32(central ? 24 : 22, 1, true)
      );
      const reader = new ArchiveReader(zipBlob(bytes), {
        ...DEFAULT_ARCHIVE_LIMITS,
        jsonBytes: 1024,
      });
      if (path === 'users.json')
        await expect(reader.discover()).rejects.toMatchObject({
          code: 'json_limit',
        });
      else {
        await reader.discover();
        await expect(collect(reader, ['C100'])).rejects.toMatchObject({
          code: 'json_limit',
        });
      }
    }
  });

  it('limits total actual selected expansion, including metadata and multibyte text', async () => {
    const entries = {
      ...standardEntries(),
      'general/2023-11-14.json': [{ ...MESSAGE, text: 'é'.repeat(500) }],
    };
    const reader = new ArchiveReader(zipBlob(zipFixture(entries)), {
      ...DEFAULT_ARCHIVE_LIMITS,
      selectedBytes: 1000,
    });
    await reader.discover();
    await expect(collect(reader, ['C100'])).rejects.toMatchObject({
      code: 'selected_limit',
    });
  });

  it('enforces the documented default 32 MiB against an actual forged-size expansion', async () => {
    const path = 'general/2023-11-14.json';
    const bytes = patchEntry(
      zipFixture({
        ...standardEntries(),
        [path]: 'x'.repeat(DEFAULT_ARCHIVE_LIMITS.jsonBytes + 1),
      }),
      path,
      (header, central) => header.setUint32(central ? 24 : 22, 1, true)
    );
    const reader = new ArchiveReader(zipBlob(bytes));
    await reader.discover();
    await expect(collect(reader, ['C100'])).rejects.toMatchObject({
      code: 'json_limit',
    });
  });

  it('enforces total expansion even when every advertised day size is smaller', async () => {
    const path = 'general/2023-11-14.json';
    const bytes = patchEntry(
      zipFixture({ ...standardEntries(), [path]: 'x'.repeat(10_000) }),
      path,
      (header, central) => header.setUint32(central ? 24 : 22, 1, true)
    );
    const reader = new ArchiveReader(zipBlob(bytes), {
      ...DEFAULT_ARCHIVE_LIMITS,
      selectedBytes: 1000,
    });
    await reader.discover();
    await expect(collect(reader, ['C100'])).rejects.toMatchObject({
      code: 'selected_limit',
    });
  });

  it('accepts the exact day byte ceiling but rejects one byte above it', async () => {
    const content = [{ ...MESSAGE, text: 'é'.repeat(1000) }];
    const length = new TextEncoder().encode(JSON.stringify(content)).length;
    for (const limit of [length, length - 1]) {
      const reader = new ArchiveReader(
        zipBlob(
          zipFixture({
            ...standardEntries(),
            'general/2023-11-14.json': content,
          })
        ),
        { ...DEFAULT_ARCHIVE_LIMITS, jsonBytes: limit }
      );
      await reader.discover();
      if (limit === length)
        expect(await collect(reader, ['C100'])).toHaveLength(1);
      else
        await expect(collect(reader, ['C100'])).rejects.toMatchObject({
          code: 'json_limit',
        });
    }
  });
});

describe('lazy worker and cancellation', () => {
  it('stages a large multi-conversation archive in two phases with bounded output', async () => {
    const count = 20_001;
    const entries: Record<string, unknown> = {
      'users.json': [],
      'channels.json': ['C100', 'C200'].map((id) => ({
        id,
        name: id,
        members: [],
      })),
    };
    for (const id of ['C100', 'C200']) {
      entries[`${id}/2023-11-14.json`] = Array.from(
        { length: count },
        (_, n) => ({
          ts: `${1700000000 + n}.000001`,
          text: 'x'.repeat(512),
        })
      );
    }
    // Stored ZIP keeps the input large, rather than hiding growth behind compression.
    const blob = zipBlob(zipFixture(entries, false));
    expect(blob.size).toBeGreaterThan(20 * 1024 * 1024);
    const slices = vi.spyOn(blob, 'slice');
    const whole = vi.spyOn(blob, 'arrayBuffer');
    const discover = vi.spyOn(ArchiveReader.prototype, 'discover');
    const history = vi.spyOn(ArchiveReader.prototype, 'readHistory');
    let records = 0;
    let parts = 0;
    let complete = false;
    let failure: ArchiveWorkerResponse | undefined;
    const seals: string[] = [];
    const sessionId = 'large-two-phase';
    const port: ArchiveWorkerPort = {
      onmessage: null,
      postMessage(message) {
        if (message.type === 'discovered') {
          send({
            type: 'read_history',
            sessionId,
            selectedIds: ['C100', 'C200'],
            includeMessageHistory: true,
          });
        } else if (message.type === 'part') {
          // Keep counters, not all output parts: the consumer releases each part.
          expect(message.bytes.byteLength).toBeLessThanOrEqual(
            16 * 1024 * 1024
          );
          expect(message.descriptor.recordCount).toBeLessThanOrEqual(20_000);
          records += message.descriptor.recordCount ?? 0;
          parts++;
          send({ type: 'ack_part', sessionId, sequence: message.sequence });
        } else if (message.type === 'seal') {
          seals.push(message.seal.slackChannelId);
          expect(message.seal.partCount).toBe(2);
        } else if (message.type === 'complete') complete = true;
        else if (message.type === 'error') failure = message;
      },
    };
    function send(request: ArchiveWorkerRequest): void {
      // Emulate worker message delivery rather than re-entering its callback.
      queueMicrotask(() =>
        port.onmessage?.({
          data: request,
        } as MessageEvent<ArchiveWorkerRequest>)
      );
    }
    installArchiveWorker(port);
    send({ type: 'discover', sessionId, archive: blob });
    await vi.waitFor(
      () => {
        expect(failure).toBeUndefined();
        expect(complete).toBe(true);
      },
      { timeout: 60_000 }
    );
    expect(discover).toHaveBeenCalledTimes(1);
    expect(history).toHaveBeenCalledTimes(1);
    expect(whole).not.toHaveBeenCalled();
    expect(
      slices.mock.calls.every(
        ([start, end]) => (end ?? 0) - (start ?? 0) <= 65557
      )
    ).toBe(true);
    expect(records).toBe(count * 2);
    expect(parts).toBe(4);
    expect(seals.sort()).toEqual(['C100', 'C200']);
    expect(
      (await indexedDB.databases()).some(
        (db) => db.name === `slack-import-scratch:${sessionId}`
      )
    ).toBe(false);
  }, 65_000);

  it('does not construct a worker on module import; the factory creates it on action', async () => {
    const Worker = vi.fn(function () {});
    vi.stubGlobal('Worker', Worker);
    vi.resetModules();
    await import('./worker-client');
    expect(Worker).not.toHaveBeenCalled();
    createSlackImportWorker();
    expect(Worker).toHaveBeenCalledExactlyOnceWith(expect.any(URL), {
      type: 'module',
    });
  });

  it('cancels a worker during a pending file read, without late discovery or requests', async () => {
    let release: (() => void) | undefined;
    const bytes = zipFixture(standardEntries());
    const blob = {
      size: bytes.length,
      slice: () => ({
        arrayBuffer: async () => {
          await new Promise<void>((resolve) => {
            release = resolve;
          });
          return new Uint8Array(bytes).buffer;
        },
      }),
    } as unknown as Blob;
    const worker = workerHarness();
    worker.send({ type: 'discover', sessionId: 's', archive: blob });
    expect(release).toBeDefined();
    worker.send({ type: 'cancel', sessionId: 's' });
    release?.();
    await worker.wait('cancelled');
    expect(worker.messages).toEqual([{ type: 'cancelled', sessionId: 's' }]);
  });

  it('permits only one unacknowledged part and can cancel while backpressured', async () => {
    const worker = workerHarness();
    worker.send({
      type: 'discover',
      sessionId: 's',
      archive: zipBlob(zipFixture(corporateEntries())),
    });
    await worker.wait('discovered');
    worker.send({
      type: 'read_history',
      sessionId: 's',
      selectedIds: ['C200', 'D100'],
      includeMessageHistory: true,
    });
    await worker.wait('part');
    worker.send({ type: 'ack_part', sessionId: 'other', sequence: 0 });
    worker.send({ type: 'ack_part', sessionId: 's', sequence: 99 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(
      worker.messages.filter((message) => message.type === 'part')
    ).toHaveLength(1);
    worker.send({ type: 'ack_part', sessionId: 's', sequence: 0 });
    await vi.waitFor(() =>
      expect(
        worker.messages.filter((message) => message.type === 'part')
      ).toHaveLength(2)
    );
    worker.send({ type: 'cancel', sessionId: 's' });
    await worker.wait('cancelled');
    expect(worker.messages.some((message) => message.type === 'complete')).toBe(
      false
    );
    expect(
      (await indexedDB.databases()).some(
        (db) => db.name === 'slack-import-scratch:s'
      )
    ).toBe(false);
  });

  it('reports quota failures only after cleanup and allows a fresh session', async () => {
    const worker = workerHarness();
    worker.send({
      type: 'discover',
      sessionId: 'quota',
      archive: zipBlob(zipFixture(standardEntries())),
    });
    await worker.wait('discovered');
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(() => {
      throw new DOMException('sensitive provider error', 'QuotaExceededError');
    });
    worker.send({
      type: 'read_history',
      sessionId: 'quota',
      selectedIds: ['C100'],
      includeMessageHistory: true,
    });
    await worker.wait('error');
    expect(worker.messages.at(-1)).toMatchObject({ code: 'storage_quota' });
    expect(
      (await indexedDB.databases()).some(
        (db) => db.name === 'slack-import-scratch:quota'
      )
    ).toBe(false);
    worker.send({
      type: 'discover',
      sessionId: 'retry',
      archive: zipBlob(zipFixture(standardEntries())),
    });
    await vi.waitFor(() =>
      expect(worker.messages.at(-1)).toMatchObject({
        type: 'discovered',
        sessionId: 'retry',
      })
    );
    worker.send({ type: 'cancel', sessionId: 'retry' });
    await worker.wait('cancelled');
  });

  it('completes shape-only with an empty seal and no parts', async () => {
    const worker = workerHarness();
    worker.send({
      type: 'discover',
      sessionId: 's',
      archive: zipBlob(zipFixture(standardEntries())),
    });
    await worker.wait('discovered');
    worker.send({
      type: 'read_history',
      sessionId: 's',
      selectedIds: ['C100'],
      includeMessageHistory: false,
    });
    await worker.wait('complete');
    expect(worker.messages.map((message) => message.type)).toEqual([
      'discovered',
      'seal',
      'complete',
    ]);
  });
});
