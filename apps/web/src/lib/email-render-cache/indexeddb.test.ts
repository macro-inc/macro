import { PREPARE_VERSION } from '@macro-inc/email-renderer';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { artifactDatabaseMayExist, IndexedDbArtifacts } from './indexeddb';
import {
  ARTIFACT_SCHEMA_VERSION,
  type Artifact,
  type Association,
  artifactBytes,
} from './store';

const NAMESPACE = 'namespace';

function artifact(key: string, lastUsed: number, size = 100): Artifact {
  const body = {
    html: 'x'.repeat(size),
    kind: 'html' as const,
    hasTable: false,
    hasHiddenContent: false,
  };
  return {
    key,
    schema: ARTIFACT_SCHEMA_VERSION,
    version: PREPARE_VERSION,
    sourceHash: 'source',
    policyHash: 'policy',
    body,
    bytes: artifactBytes(body),
    lastUsed,
  };
}

function association(
  id: string,
  key: string,
  sourceHash = 'source'
): Association {
  return {
    id,
    threadId: 'thread',
    mailboxId: 'inbox',
    sourceHash,
    keys: [key],
  };
}

/** Reads every store through a separate connection, as a later session would. */
async function dump() {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const opening = indexedDB.open(`macro-email-renders-${NAMESPACE}`, 1);
    opening.onsuccess = () => resolve(opening.result);
    opening.onerror = () => reject(opening.error);
  });
  const all = <T>(name: string) =>
    new Promise<T[]>((resolve) => {
      const request = db.transaction(name).objectStore(name).getAll();
      request.onsuccess = () => resolve(request.result as T[]);
    });
  const state = await new Promise<{ generation: number; bytes: number }>(
    (resolve) => {
      const request = db
        .transaction('namespaceState')
        .objectStore('namespaceState')
        .get('state');
      request.onsuccess = () => resolve(request.result);
    }
  );
  const artifacts = await all<Artifact>('artifacts');
  const associations = await all<Association>('messageAssociations');
  db.close();
  return { state, artifacts, associations };
}

/** Byte accounting must equal what the stores actually hold. */
function accountedBytes(contents: Awaited<ReturnType<typeof dump>>): number {
  return (
    contents.artifacts.reduce((total, value) => total + value.bytes, 0) +
    contents.associations.reduce(
      (total, value) => total + 2 * JSON.stringify(value).length,
      0
    )
  );
}

describe('IndexedDB artifact store', () => {
  const stores: IndexedDbArtifacts[] = [];
  function open(budget = 1024 * 1024) {
    const store = new IndexedDbArtifacts(NAMESPACE, budget);
    stores.push(store);
    return store;
  }
  beforeEach(() => {
    vi.stubGlobal('indexedDB', new IDBFactory());
  });
  afterEach(() => {
    for (const store of stores.splice(0)) store.close();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('round-trips an artifact and accounts for every stored byte', async () => {
    const store = open();
    expect(await store.generation()).toBe(0);
    const value = artifact('a', 1);
    expect(await store.write(0, value, association('message', 'a'))).toBe(true);
    expect(await store.read('a')).toEqual(value);
    const contents = await dump();
    expect(contents.state.bytes).toBe(accountedBytes(contents));
  });

  it('rejects a write from an older generation and one larger than the budget', async () => {
    const store = open(4096);
    await store.invalidate();
    expect(
      await store.write(
        0,
        artifact('stale', 1),
        association('message', 'stale')
      )
    ).toBe(false);
    // Too large to keep, but not stale: the caller must not treat it as such.
    expect(
      await store.write(1, artifact('huge', 1, 4096), association('m', 'huge'))
    ).toBe(true);
    const contents = await dump();
    expect(contents.artifacts).toEqual([]);
    expect(contents.associations).toEqual([]);
    expect(contents.state).toEqual({ generation: 1, bytes: 0 });
  });

  it('evicts least recently used artifacts and their association references', async () => {
    const store = open(2 * artifact('a', 0, 3000).bytes + 1024);
    await store.write(0, artifact('old', 1, 3000), association('first', 'old'));
    await store.write(
      0,
      artifact('mid', 2, 3000),
      association('second', 'mid')
    );
    await store.write(0, artifact('new', 3, 3000), association('third', 'new'));
    const contents = await dump();
    expect(contents.artifacts.map((value) => value.key).sort()).toEqual([
      'mid',
      'new',
    ]);
    expect(contents.associations.map((value) => value.id).sort()).toEqual([
      'second',
      'third',
    ]);
    expect(contents.state.bytes).toBe(accountedBytes(contents));
    expect(contents.state.bytes).toBeLessThanOrEqual(
      2 * artifact('a', 0, 3000).bytes + 1024
    );
  });

  it('caps policy variants per message and restarts them for a new source', async () => {
    const store = open();
    for (let index = 0; index < 10; index++) {
      const key = `variant-${index}`;
      await store.write(0, artifact(key, index), association('message', key));
    }
    let contents = await dump();
    expect(contents.associations).toHaveLength(1);
    expect(contents.associations[0].keys).toEqual(
      Array.from({ length: 8 }, (_, index) => `variant-${index + 2}`)
    );
    expect(contents.state.bytes).toBe(accountedBytes(contents));
    await store.write(
      0,
      artifact('edited', 11),
      association('message', 'edited', 'edited-source')
    );
    contents = await dump();
    expect(contents.associations[0].keys).toEqual(['edited']);
    expect(contents.associations[0].sourceHash).toBe('edited-source');
  });

  it('removes an artifact and its bytes without going negative', async () => {
    const store = open();
    await store.write(0, artifact('a', 1), association('message', 'a'));
    await store.remove('a');
    await store.remove('missing');
    const contents = await dump();
    expect(contents.artifacts).toEqual([]);
    expect(contents.state.bytes).toBe(accountedBytes(contents));
  });

  it('invalidates with a new generation; quota eviction keeps the generation', async () => {
    const store = open();
    await store.write(0, artifact('a', 1), association('message', 'a'));
    await store.evict();
    let contents = await dump();
    expect(contents).toMatchObject({
      state: { generation: 0, bytes: 0 },
      artifacts: [],
      associations: [],
    });
    await store.write(0, artifact('b', 2), association('message', 'b'));
    await store.invalidate();
    contents = await dump();
    expect(contents).toMatchObject({
      state: { generation: 1, bytes: 0 },
      artifacts: [],
      associations: [],
    });
    expect(await store.generation()).toBe(1);
  });

  it('batches access times for read artifacts', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const store = open();
    await store.write(0, artifact('a', 1), association('message', 'a'));
    await store.read('a');
    await store.read('missing');
    expect((await dump()).artifacts[0].lastUsed).toBe(1);
    await vi.advanceTimersByTimeAsync(5000);
    vi.useRealTimers();
    await vi.waitFor(async () =>
      expect((await dump()).artifacts[0].lastUsed).toBeGreaterThan(1)
    );
  });

  it('reports whether a database could exist without creating one', async () => {
    expect(await artifactDatabaseMayExist(NAMESPACE)).toBe(false);
    expect(await indexedDB.databases()).toEqual([]);
    await open().generation();
    expect(await artifactDatabaseMayExist(NAMESPACE)).toBe(true);
    vi.stubGlobal('indexedDB', {});
    expect(await artifactDatabaseMayExist(NAMESPACE)).toBe(true);
  });
});
