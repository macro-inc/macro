/**
 * Round-2 adversarial checks against the IndexedDbArtifacts fixes:
 * stale-generation reporting, clear-only (create=false) opens, and
 * association cleanup in remove().
 */
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
const NAME = `macro-email-renders-${NAMESPACE}`;

function artifact(key: string, size = 0, lastUsed = 1): Artifact {
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

const association = (id: string, key: string): Association => ({
  id,
  threadId: 'thread',
  mailboxId: 'mailbox',
  sourceHash: 'source',
  keys: [key],
});

async function dump() {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const opening = indexedDB.open(NAME, 1);
    opening.onsuccess = () => resolve(opening.result);
    opening.onerror = () => reject(opening.error);
  });
  const get = <T>(name: string) =>
    new Promise<T>((resolve) => {
      const request =
        name === 'namespaceState'
          ? db.transaction(name).objectStore(name).get('state')
          : db.transaction(name).objectStore(name).getAll();
      request.onsuccess = () => resolve(request.result as T);
    });
  const state = await get<{ generation: number; bytes: number }>(
    'namespaceState'
  );
  const artifacts = await get<Artifact[]>('artifacts');
  const associations = await get<Association[]>('messageAssociations');
  db.close();
  return { state, artifacts, associations };
}

async function rawPut(storeName: string, value: unknown) {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const opening = indexedDB.open(NAME, 1);
    opening.onsuccess = () => resolve(opening.result);
    opening.onerror = () => reject(opening.error);
  });
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readwrite');
    transaction.objectStore(storeName).put(value);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  db.close();
}

const stores: IndexedDbArtifacts[] = [];
const track = (store: IndexedDbArtifacts) => {
  stores.push(store);
  return store;
};
beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory());
});
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  vi.unstubAllGlobals();
});

describe('clear-only stores (create = false)', () => {
  it('holds: clearing a namespace that never existed leaves no database and resolves', async () => {
    const clearer = track(new IndexedDbArtifacts(NAMESPACE, 0, false));
    await expect(clearer.invalidate()).resolves.toBeUndefined();
    expect(await indexedDB.databases()).toEqual([]);
    expect(await artifactDatabaseMayExist(NAMESPACE)).toBe(false);
    // A later enabled session still creates and uses the database normally.
    const store = track(new IndexedDbArtifacts(NAMESPACE, 1024 * 1024));
    expect(await store.generation()).toBe(0);
    expect(await store.write(0, artifact('a'), association('m', 'a'))).toBe(
      true
    );
  });

  it('holds: clearing an existing namespace bumps its generation and empties it', async () => {
    const writer = track(new IndexedDbArtifacts(NAMESPACE, 1024 * 1024));
    await writer.write(
      await writer.generation(),
      artifact('a', 10),
      association('m', 'a')
    );
    const clearer = track(new IndexedDbArtifacts(NAMESPACE, 0, false));
    await clearer.invalidate();
    const contents = await dump();
    expect(contents.state).toEqual({ generation: 1, bytes: 0 });
    expect(contents.artifacts).toEqual([]);
    expect(contents.associations).toEqual([]);
    // The writer's next write reports the missed invalidation.
    expect(
      await writer.write(0, artifact('b', 10), association('n', 'b'))
    ).toBe(false);
  });

  it('holds: a clear-only open racing a creating open yields one consistent database', async () => {
    const clearer = track(new IndexedDbArtifacts(NAMESPACE, 0, false));
    const creator = track(new IndexedDbArtifacts(NAMESPACE, 1024 * 1024));
    const [, generation] = await Promise.all([
      clearer.invalidate(),
      creator.generation(),
    ]);
    // Either order is fine, as long as the creator's generation is the one
    // its writes are judged against.
    const written = await creator.write(
      generation,
      artifact('a'),
      association('m', 'a')
    );
    const contents = await dump();
    expect(written).toBe(contents.state.generation === generation);
  });
});

describe('stale generation reporting', () => {
  it('an over-budget write from a session that missed an invalidation still reports the stale generation', async () => {
    // ArtifactStore.write: "Resolves false only when storage was invalidated
    // after `generation`". The over-budget early return answers `true`
    // without looking, so a session whose bodies are large never learns it
    // missed an invalidation from its writes (it keeps serving and re-reading
    // under a stale generation until a small body happens to be written).
    const budget = 4096;
    const stale = track(new IndexedDbArtifacts(NAMESPACE, budget));
    const generation = await stale.generation();
    const other = track(new IndexedDbArtifacts(NAMESPACE, budget));
    await other.invalidate();
    const big = artifact('big', budget); // bytes = 2 * budget + 1024 > budget
    expect(big.bytes).toBeGreaterThan(budget);
    expect(await stale.write(generation, big, association('m', 'big'))).toBe(
      false
    );
  });
});

describe('remove() association cleanup', () => {
  it('holds: remove() drops the key from shared associations and keeps bytes exact', async () => {
    const store = track(new IndexedDbArtifacts(NAMESPACE, 1024 * 1024));
    const generation = await store.generation();
    await store.write(generation, artifact('a', 10), association('m', 'a'));
    await store.write(generation, artifact('b', 10), {
      ...association('m', 'b'),
    });
    await store.write(generation, artifact('a', 10), association('n', 'a'));
    await Promise.all([store.remove('a'), store.remove('a')]);
    const contents = await dump();
    expect(contents.artifacts.map((value) => value.key)).toEqual(['b']);
    expect(
      contents.associations.map((value) => [value.id, value.keys])
    ).toEqual([['m', ['b']]]);
    const bytes =
      contents.artifacts.reduce((total, value) => total + value.bytes, 0) +
      contents.associations.reduce(
        (total, value) => total + 2 * JSON.stringify(value).length,
        0
      );
    expect(contents.state.bytes).toBe(bytes);
  });

  it('a corrupt artifact with a huge finite byte count cannot disable eviction', async () => {
    // A record's stored `bytes` is never trusted: sizes come from the body.
    // A record written outside the accounting (corruption, a foreign build)
    // can overshoot the budget by at most its own size, never disable it.
    const budget = 64 * 1024;
    const store = track(new IndexedDbArtifacts(NAMESPACE, budget));
    const generation = await store.generation();
    await store.write(
      generation,
      artifact('seed', 10, 2),
      association('s', 'seed')
    );
    const corrupt = { ...artifact('corrupt', 0, 0), bytes: 1e15 };
    await rawPut('artifacts', corrupt);
    const uncounted = 2 * corrupt.body.html.length + 1024;
    for (let i = 0; i < 40; i++)
      await store.write(
        generation,
        artifact(`k${i}`, 4096, 10 + i),
        association(`m${i}`, `k${i}`)
      );
    const contents = await dump();
    const stored =
      contents.artifacts.reduce(
        (total, value) => total + 2 * value.body.html.length + 1024,
        0
      ) +
      contents.associations.reduce(
        (total, value) => total + 2 * JSON.stringify(value).length,
        0
      );
    expect(stored).toBeLessThanOrEqual(budget + uncounted);
    // Eviction keeps working: the newest writes are kept, old ones go.
    expect(contents.artifacts.some((value) => value.key === 'k39')).toBe(true);
    expect(contents.artifacts.some((value) => value.key === 'k0')).toBe(false);
    expect(contents.state.bytes).toBeGreaterThanOrEqual(0);
  });
});
