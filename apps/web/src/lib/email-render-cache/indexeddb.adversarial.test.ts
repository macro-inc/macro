/**
 * Deterministic reproductions against IndexedDbArtifacts.
 */
import { PREPARE_VERSION } from '@macro-inc/email-renderer';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { IndexedDbArtifacts } from './indexeddb';
import {
  ARTIFACT_SCHEMA_VERSION,
  type Artifact,
  type Association,
  artifactBytes,
} from './store';

const NAMESPACE = 'namespace';

function artifact(key: string, size = 0): Artifact {
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
    lastUsed: 1,
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
    const opening = indexedDB.open(`macro-email-renders-${NAMESPACE}`, 1);
    opening.onsuccess = () => resolve(opening.result);
    opening.onerror = () => reject(opening.error);
  });
  const all = <T>(name: string) =>
    new Promise<T>((resolve) => {
      const request =
        name === 'namespaceState'
          ? db.transaction(name).objectStore(name).get('state')
          : db.transaction(name).objectStore(name).getAll();
      request.onsuccess = () => resolve(request.result as T);
    });
  const state = await all<{ generation: number; bytes: number }>(
    'namespaceState'
  );
  const artifacts = await all<Artifact[]>('artifacts');
  const associations = await all<Association[]>('messageAssociations');
  db.close();
  return { state, artifacts, associations };
}

const stores: IndexedDbArtifacts[] = [];
beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory());
});
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  vi.unstubAllGlobals();
});

it('remove() does not leave associations that eviction can never reclaim', async () => {
  // service.load() calls remove() for a stored record that fails validation
  // (corruption, or every record after an ARTIFACT_SCHEMA_VERSION / bytes
  // formula change, neither of which is part of the key). If the re-prepared
  // body is not written back (cancelled speculation, failed write), the
  // message association keeps pointing at the removed key.
  const budget = 4096;
  const store = new IndexedDbArtifacts(NAMESPACE, budget);
  stores.push(store);
  for (let index = 0; index < 40; index++) {
    await store.write(
      0,
      artifact(`k${index}`),
      association(`m${index}`, `k${index}`)
    );
    await store.remove(`k${index}`);
  }
  // Nothing is stored any more, so a fresh small artifact must fit.
  await store.write(0, artifact('fresh'), association('fresh', 'fresh'));
  const contents = await dump();
  // Regression: indexeddb.ts remove() deletes only the artifact; its associations
  // stay, are still byte-accounted, and the eviction cursor (which walks
  // artifacts) can never reach them. Here 17 orphaned associations (~2.9 KB)
  // remain forever and every later write is evicted immediately after commit.
  expect(contents.artifacts.map((value) => value.key)).toEqual(['fresh']);
  expect(
    contents.associations.filter((value) =>
      value.keys.every(
        (key) => !contents.artifacts.some((stored) => stored.key === key)
      )
    )
  ).toEqual([]);
});

it('a foreign/corrupt artifact record cannot poison byte accounting (robustness)', async () => {
  // remove() guards non-finite `bytes` (Number.isFinite), so foreign records
  // are anticipated, e.g. a tab running a different ARTIFACT_SCHEMA_VERSION
  // against the same database version during a deploy. The eviction cursor and
  // write() do not guard.
  const budget = 8192;
  const store = new IndexedDbArtifacts(NAMESPACE, budget);
  stores.push(store);
  await store.generation();
  const db = await new Promise<IDBDatabase>((resolve) => {
    const opening = indexedDB.open(`macro-email-renders-${NAMESPACE}`, 1);
    opening.onsuccess = () => resolve(opening.result);
  });
  await new Promise<void>((resolve) => {
    const transaction = db.transaction('artifacts', 'readwrite');
    transaction
      .objectStore('artifacts')
      .put({ key: 'foreign', lastUsed: 0, body: { html: 'x' } });
    transaction.oncomplete = () => resolve();
  });
  db.close();
  for (let index = 0; index < 6; index++)
    await store.write(
      0,
      artifact(`k${index}`, 1000),
      association(`m${index}`, `k${index}`)
    );
  const contents = await dump();
  // Regression: `state.bytes -= value.bytes` in the eviction cursor turns
  // the counter into NaN; `NaN <= budget` is false, so from then on every
  // write evicts everything it can, including itself.
  expect(Number.isFinite(contents.state.bytes)).toBe(true);
  expect(contents.artifacts.map((value) => value.key)).toContain('k5');
});
