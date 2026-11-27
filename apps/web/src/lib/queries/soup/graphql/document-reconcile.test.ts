import { INITIAL_CACHE_REVISION } from '@graphql-cache/index';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createDocumentVerifier,
  type DocumentReconcileHost,
  type ReadDocumentFromPrimary,
  removeDocumentsGoneOnPrimary,
} from './document-reconcile';

vi.mock('@macro-inc/observability', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  Telemetry: {
    error: vi.fn(),
    span: async (
      _name: string,
      operation: (span: {
        setAttr: () => void;
        error: () => void;
        run: <T>(work: () => T) => T;
      }) => Promise<unknown>
    ) =>
      operation({ setAttr: () => {}, error: () => {}, run: (work) => work() }),
  },
}));
vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupCacheHost: vi.fn(),
  getGraphqlSoupClient: vi.fn(),
}));

type CachedDocument = { name: string; pending?: boolean };

/** A cache holding document records by id. `onRead` runs after each read of
 * records, so a test can rewrite one between the two looks. */
function fakeDocumentCache(documents: Record<string, CachedDocument>) {
  const records = new Map(Object.entries(documents));
  let reads = 0;
  const hooks: { onRead?: (read: number) => void } = {};
  const host = {
    disabled: false,
    readRecordsByKeys: vi.fn(async ({ keys }: { keys: string[] }) => {
      const result = {
        revision: INITIAL_CACHE_REVISION,
        records: keys.flatMap((recordKey) => {
          const id = recordKey.replace('GraphqlSoupDocument:', '');
          const document = records.get(id);
          if (!document) return [];
          return [
            {
              recordKey,
              record: {
                __typename: 'GraphqlSoupDocument',
                name: document.name,
              },
              identity: { mutationUuid: null, pending: !!document.pending },
            },
          ];
        }),
      };
      reads += 1;
      hooks.onRead?.(reads);
      return result;
    }),
    deleteRecords: vi.fn(async (keys: string[], _session?: string) => {
      for (const key of keys)
        records.delete(key.replace('GraphqlSoupDocument:', ''));
      return { affectedOps: [] };
    }),
  };
  return {
    host: host as unknown as DocumentReconcileHost & typeof host,
    records,
    hooks,
  };
}

const goneUnless =
  (readable: readonly string[]): ReadDocumentFromPrimary =>
  async (id) =>
    readable.includes(id) ? 'readable' : 'gone';

const deletedKeys = (host: {
  deleteRecords: { mock: { calls: unknown[][] } };
}) => host.deleteRecords.mock.calls.flatMap(([keys]) => keys as string[]);

describe('removeDocumentsGoneOnPrimary', () => {
  it('deletes a cached document the owner moved to the Trash while this client was away', async () => {
    // The owner's client was closed when the realtime Deleted patch went out,
    // so the cache still holds the document under its old name.
    const { host, records } = fakeDocumentCache({
      trashed: { name: 'Launch checklist' },
      live: { name: 'Launch checklist' },
    });
    const read = vi.fn(goneUnless(['live']));

    const result = await removeDocumentsGoneOnPrimary({
      host,
      ids: ['trashed', 'live'],
      readFromPrimary: read,
      session: () => 's1',
    });

    expect(result).toEqual({ removed: ['trashed'], outcome: 'removed' });
    expect(deletedKeys(host)).toEqual(['GraphqlSoupDocument:trashed']);
    expect(host.deleteRecords.mock.calls[0]?.[1]).toBe('s1');
    expect([...records.keys()]).toEqual(['live']);
    // Once more after the delete, which would write it back if readable.
    expect(read.mock.calls.map(([id, , selection]) => [id, selection])).toEqual(
      [
        ['trashed', 'name'],
        ['live', 'name'],
        // A restored document gets back every field its lists read.
        ['trashed', 'full'],
      ]
    );
  });

  it('deletes a shared document a collaborator can no longer read', async () => {
    const { host } = fakeDocumentCache({ shared: { name: 'Shared plan' } });

    const result = await removeDocumentsGoneOnPrimary({
      host,
      ids: ['shared'],
      readFromPrimary: goneUnless([]),
      session: () => 's1',
    });

    expect(result.removed).toEqual(['shared']);
    expect(deletedKeys(host)).toEqual(['GraphqlSoupDocument:shared']);
  });

  it('keeps documents the primary still shows', async () => {
    const { host } = fakeDocumentCache({ live: { name: 'Plan' } });

    const result = await removeDocumentsGoneOnPrimary({
      host,
      ids: ['live'],
      readFromPrimary: goneUnless(['live']),
      session: () => 's1',
    });

    expect(result).toEqual({ removed: [], outcome: 'readable' });
    expect(host.deleteRecords).not.toHaveBeenCalled();
  });

  it('reads nothing for documents the cache does not hold', async () => {
    const { host } = fakeDocumentCache({});
    const read = vi.fn(goneUnless([]));

    const result = await removeDocumentsGoneOnPrimary({
      host,
      ids: ['snippet'],
      readFromPrimary: read,
      session: () => 's1',
    });

    expect(result.outcome).toBe('not_cached');
    expect(read).not.toHaveBeenCalled();
  });

  it('keeps a record rewritten between the two looks', async () => {
    const { host, records, hooks } = fakeDocumentCache({
      restored: { name: 'Plan' },
    });
    // A restore lands after the first look; the read answered before it.
    hooks.onRead = (read) => {
      if (read === 1) records.set('restored', { name: 'Plan (restored)' });
    };

    const result = await removeDocumentsGoneOnPrimary({
      host,
      ids: ['restored'],
      readFromPrimary: goneUnless([]),
      session: () => 's1',
    });

    expect(result.outcome).toBe('rewritten');
    expect(host.deleteRecords).not.toHaveBeenCalled();
  });

  it('never deletes a record with a pending local write', async () => {
    const { host } = fakeDocumentCache({
      restoring: { name: 'Plan', pending: true },
    });
    const read = vi.fn(goneUnless([]));

    const result = await removeDocumentsGoneOnPrimary({
      host,
      ids: ['restoring'],
      readFromPrimary: read,
      session: () => 's1',
    });

    expect(result.outcome).toBe('not_cached');
    expect(read).not.toHaveBeenCalled();
    expect(host.deleteRecords).not.toHaveBeenCalled();
  });

  it('deletes under the session the evidence was read in', async () => {
    const { host } = fakeDocumentCache({ trashed: { name: 'Plan' } });
    let session = 's1';
    const read: ReadDocumentFromPrimary = async () => {
      session = 's2';
      return 'gone';
    };

    await removeDocumentsGoneOnPrimary({
      host,
      ids: ['trashed'],
      readFromPrimary: read,
      session: () => session,
    });

    // The cache refuses a delete stamped with a session that has ended.
    expect(host.deleteRecords.mock.calls[0]?.[1]).toBe('s1');
  });

  it('deletes nothing when a read fails', async () => {
    const { host } = fakeDocumentCache({ trashed: { name: 'Plan' } });

    await expect(
      removeDocumentsGoneOnPrimary({
        host,
        ids: ['trashed'],
        readFromPrimary: async () => {
          throw new Error('offline');
        },
        session: () => 's1',
      })
    ).rejects.toThrow('offline');
    expect(host.deleteRecords).not.toHaveBeenCalled();
  });

  it('writes back a document restored meanwhile even after the caller stops', async () => {
    const { host, records } = fakeDocumentCache({ restored: { name: 'Plan' } });
    const controller = new AbortController();
    let reads = 0;
    host.deleteRecords.mockImplementationOnce(async (keys: string[]) => {
      for (const key of keys)
        records.delete(key.replace('GraphqlSoupDocument:', ''));
      // The search closes just after the delete is sent.
      controller.abort();
      return { affectedOps: [] };
    });

    const result = await removeDocumentsGoneOnPrimary({
      host,
      ids: ['restored'],
      readFromPrimary: async (_id, signal) => {
        reads += 1;
        if (reads === 1) return 'gone';
        // The restore landed; this read writes the record back.
        expect(signal).toBeUndefined();
        records.set('restored', { name: 'Plan' });
        return 'readable';
      },
      session: () => 's1',
      signal: controller.signal,
    });

    expect(result.outcome).toBe('removed');
    expect(reads).toBe(2);
    expect([...records.keys()]).toEqual(['restored']);
  });

  it('reports a delete whose second look failed', async () => {
    const { host } = fakeDocumentCache({ trashed: { name: 'Plan' } });
    let reads = 0;

    const result = await removeDocumentsGoneOnPrimary({
      host,
      ids: ['trashed'],
      readFromPrimary: async () => {
        reads += 1;
        if (reads > 1) throw new Error('offline');
        return 'gone';
      },
      session: () => 's1',
    });

    expect(result).toEqual({
      removed: ['trashed'],
      outcome: 'removed_unconfirmed',
    });
  });
});

describe('createDocumentVerifier', () => {
  afterEach(() => vi.useRealTimers());

  it('checks each document at most once every few minutes', async () => {
    vi.useFakeTimers();
    const { host } = fakeDocumentCache({ a: { name: 'A' }, b: { name: 'B' } });
    const read = vi.fn(goneUnless(['a', 'b']));
    let now = 0;
    const verifier = createDocumentVerifier({
      host: () => host,
      readFromPrimary: read,
      session: () => 's1',
      now: () => now,
    });

    verifier.verify(['a']);
    await vi.runAllTimersAsync();
    verifier.verify(['a', 'b']);
    await vi.runAllTimersAsync();
    now = 5 * 60_000;
    verifier.verify(['a']);
    await vi.runAllTimersAsync();

    expect(read.mock.calls.map(([id]) => id)).toEqual(['a', 'b', 'a']);
  });

  it('checks a document again after a failed check', async () => {
    const { host } = fakeDocumentCache({ a: { name: 'A' } });
    let fail = true;
    const read = vi.fn<ReadDocumentFromPrimary>(async () => {
      if (fail) throw new Error('offline');
      return 'readable';
    });
    const verifier = createDocumentVerifier({
      host: () => host,
      readFromPrimary: read,
      session: () => 's1',
    });

    verifier.verify(['a']);
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 0));
    fail = false;
    verifier.verify(['a']);
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2));
  });

  it('checks once the cache is ready when it was not at first', async () => {
    const { host } = fakeDocumentCache({ a: { name: 'A' } });
    const read = vi.fn(goneUnless(['a']));
    let ready = false;
    const verifier = createDocumentVerifier({
      host: () => (ready ? host : undefined),
      readFromPrimary: read,
      session: () => 's1',
    });

    verifier.verify(['a']);
    ready = true;
    verifier.verify(['a']);
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(1));
  });

  it('checks a removed document again if a list writes it back', async () => {
    const { host, records } = fakeDocumentCache({ a: { name: 'A' } });
    const read = vi.fn(goneUnless([]));
    const verifier = createDocumentVerifier({
      host: () => host,
      readFromPrimary: read,
      session: () => 's1',
    });

    verifier.verify(['a']);
    await vi.waitFor(() => expect(records.has('a')).toBe(false));
    await new Promise((resolve) => setTimeout(resolve, 0));
    // A list read from a lagging replica writes the trashed record back.
    records.set('a', { name: 'A' });
    verifier.verify(['a']);
    await vi.waitFor(() => expect(records.has('a')).toBe(false));
    // Two looks for each check: before the delete, and once after it.
    expect(read).toHaveBeenCalledTimes(4);
  });

  it('checks a document a list wrote back while its check was running', async () => {
    const { host, records } = fakeDocumentCache({ a: { name: 'A' } });
    let release: (() => void) | undefined;
    let reads = 0;
    const verifier = createDocumentVerifier({
      host: () => host,
      readFromPrimary: async () => {
        reads += 1;
        // The confirming read waits while a search features the document.
        if (reads === 2) await new Promise<void>((done) => (release = done));
        return 'gone';
      },
      session: () => 's1',
    });

    verifier.verify(['a']);
    await vi.waitFor(() => expect(release).toBeDefined());
    // A lagging list writes the trashed record back, and a search shows it.
    records.set('a', { name: 'A' });
    verifier.verify(['a']);
    release?.();

    await vi.waitFor(() => expect(reads).toBe(4));
    await vi.waitFor(() => expect(records.has('a')).toBe(false));
  });

  it('reads at most a few documents at once across overlapping searches', async () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
    const { host } = fakeDocumentCache(
      Object.fromEntries(ids.map((id) => [id, { name: id }]))
    );
    let open = 0;
    let peak = 0;
    const verifier = createDocumentVerifier({
      host: () => host,
      readFromPrimary: async () => {
        open += 1;
        peak = Math.max(peak, open);
        await new Promise((resolve) => setTimeout(resolve, 0));
        open -= 1;
        return 'readable';
      },
      session: () => 's1',
    });

    verifier.verify(['a', 'b', 'c']);
    verifier.verify(['d', 'e', 'f']);
    await vi.waitFor(() =>
      expect(host.readRecordsByKeys).toHaveBeenCalledTimes(2)
    );
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(peak).toBe(3);
  });

  it('does nothing without a cache, or once disposed', async () => {
    const read = vi.fn(goneUnless([]));
    const without = createDocumentVerifier({
      host: () => undefined,
      readFromPrimary: read,
    });
    without.verify(['a']);

    const { host } = fakeDocumentCache({ a: { name: 'A' } });
    const disposed = createDocumentVerifier({
      host: () => host,
      readFromPrimary: read,
    });
    disposed.dispose();
    disposed.verify(['a']);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(read).not.toHaveBeenCalled();
    expect(host.readRecordsByKeys).not.toHaveBeenCalled();
  });
});
