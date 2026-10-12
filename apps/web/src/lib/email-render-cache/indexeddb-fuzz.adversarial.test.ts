/**
 * Model-based fuzzing of IndexedDbArtifacts on fake-indexeddb.
 *
 * Random sequences (sometimes concurrent, sometimes from two "tabs" with
 * different budgets) of write / stale write / read / batched touch / remove /
 * invalidate / evict. After every operation we read all stores through a
 * separate connection and assert:
 *  - namespaceState.bytes equals the bytes actually stored (artifacts' `bytes`
 *    plus 2 × JSON length of each association);
 *  - after a write, bytes are within that writer's budget;
 *  - every association key refers to a stored artifact (no dangling references
 *    that can never be evicted), associations hold at most 8 keys;
 *  - the generation never decreases and a stale-generation write changes nothing.
 *
 * Reproduce with FUZZ_SEED=<n>; scale with FUZZ_SEEDS / FUZZ_STEPS.
 */
import { PREPARE_VERSION } from '@macro-inc/email-renderer';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IndexedDbArtifacts } from './indexeddb';
import {
  ARTIFACT_SCHEMA_VERSION,
  type Artifact,
  type Association,
  artifactBytes,
} from './store';

function mulberry32(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: <T>(values: readonly T[]): T =>
      values[Math.floor(next() * values.length)],
    chance: (p: number) => next() < p,
  };
}

const NAMESPACE = 'fuzz';

function artifact(key: string, size: number, lastUsed: number): Artifact {
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

async function dump() {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const opening = indexedDB.open(`macro-email-renders-${NAMESPACE}`, 1);
    opening.onsuccess = () => resolve(opening.result);
    opening.onerror = () => reject(opening.error);
  });
  const get = <T>(name: string, query?: IDBValidKey) =>
    new Promise<T>((resolve, reject) => {
      const store = db.transaction(name).objectStore(name);
      const request = query === undefined ? store.getAll() : store.get(query);
      request.onsuccess = () => resolve(request.result as T);
      request.onerror = () => reject(request.error);
    });
  const state = await get<{ generation: number; bytes: number }>(
    'namespaceState',
    'state'
  );
  const artifacts = await get<Artifact[]>('artifacts');
  const associations = await get<Association[]>('messageAssociations');
  db.close();
  return { state, artifacts, associations };
}

class Violation extends Error {}

async function runSeed(seed: number, steps: number) {
  const rng = mulberry32(seed);
  vi.stubGlobal('indexedDB', new IDBFactory());
  const budgets = [rng.pick([4096, 16384, 65536])];
  const twoTabs = rng.chance(0.3);
  if (twoTabs) budgets.push(rng.pick([4096, 16384, 65536]));
  const stores = budgets.map(
    (budget) => new IndexedDbArtifacts(NAMESPACE, budget)
  );
  const log: string[] = [
    `seed=${seed} budgets=${budgets.join(',')} twoTabs=${twoTabs}`,
  ];
  const violations: string[] = [];
  const fail = (message: string) => {
    violations.push(message);
    throw new Violation(message);
  };
  const KEYS = Array.from({ length: 24 }, (_, i) => `k${i}`);
  const IDS = Array.from({ length: 16 }, (_, i) => `id${i}`);
  const SOURCES = ['s0', 's1', 's2'];
  const allowRemove = !process.env.FUZZ_NO_REMOVE;
  const dangling = new Set<string>();
  let clock = 1;
  let lastGeneration = 0;

  async function check(where: string, writer?: number) {
    const contents = await dump();
    const stored =
      contents.artifacts.reduce((total, value) => total + value.bytes, 0) +
      contents.associations.reduce(
        (total, value) => total + 2 * JSON.stringify(value).length,
        0
      );
    if (contents.state.bytes !== stored)
      fail(
        `${where}: namespaceState.bytes ${contents.state.bytes} != stored ${stored}`
      );
    if (contents.state.generation < lastGeneration)
      fail(`${where}: generation went backwards`);
    lastGeneration = contents.state.generation;
    const keys = new Set(contents.artifacts.map((value) => value.key));
    for (const association of contents.associations) {
      if (association.keys.length > 8)
        fail(`${where}: association ${association.id} holds >8 keys`);
      if (!association.keys.length)
        fail(`${where}: empty association ${association.id} kept`);
      for (const key of association.keys)
        if (!keys.has(key) && !dangling.has(`${association.id}/${key}`)) {
          dangling.add(`${association.id}/${key}`);
          violations.push(
            `${where}: association ${association.id} references missing artifact ${key}`
          );
        }
    }
    if (writer !== undefined && contents.state.bytes > budgets[writer])
      fail(
        `${where}: ${contents.state.bytes} bytes exceed the writer's budget ${budgets[writer]}`
      );
    return contents;
  }

  async function op(): Promise<{ name: string; writer?: number }> {
    const tab = rng.int(0, stores.length - 1);
    const store = stores[tab];
    const roll = rng.next();
    if (roll < 0.5) {
      const generation = await store.generation();
      const key = rng.pick(KEYS);
      const size = rng.pick([0, 10, 300, 1000, 3000, 6000]);
      const lastUsed = rng.chance(0.8) ? clock++ : rng.int(0, clock);
      const association: Association = {
        id: rng.pick(IDS),
        threadId: 'thread',
        mailboxId: 'mailbox',
        sourceHash: rng.pick(SOURCES),
        keys: [key],
      };
      const stale = rng.chance(0.1);
      const before = stale ? await dump() : undefined;
      const value = artifact(key, size, lastUsed);
      const current = await store.write(
        stale ? generation - 1 : generation,
        value,
        association
      );
      if (stale) {
        // Oversized artifacts are dropped before the generation check and
        // deliberately report true (documented in the adapter's tests).
        if (current !== false && value.bytes <= budgets[tab])
          fail('stale write reported current');
        const after = await dump();
        if (JSON.stringify(after) !== JSON.stringify(before))
          fail('stale write changed storage');
      }
      return {
        name: `tab${tab} write${stale ? '(stale)' : ''} ${key} size=${size} lastUsed=${lastUsed} ${association.id}/${association.sourceHash} -> ${current}`,
        // An oversized artifact is skipped without evicting anything.
        writer: stale || value.bytes > budgets[tab] ? undefined : tab,
      };
    }
    if (roll < 0.65) {
      const key = rng.pick(KEYS);
      await store.read(key);
      return { name: `tab${tab} read ${key}` };
    }
    if (roll < 0.72) {
      await (store as unknown as { touch(): Promise<void> }).touch();
      return { name: `tab${tab} touch` };
    }
    if (roll < 0.82 && allowRemove) {
      const key = rng.pick(KEYS);
      await store.remove(key);
      return { name: `tab${tab} remove ${key}` };
    }
    if (roll < 0.86) {
      await store.invalidate();
      return { name: `tab${tab} invalidate` };
    }
    if (roll < 0.9) {
      await store.evict();
      return { name: `tab${tab} evict` };
    }
    // Concurrent operations from both tabs; transactions must serialize.
    const count = rng.int(2, 4);
    const names: string[] = [];
    const work: Promise<unknown>[] = [];
    for (let i = 0; i < count; i++) {
      const t = rng.int(0, stores.length - 1);
      const key = rng.pick(KEYS);
      if (rng.chance(0.7)) {
        const generation = lastGeneration;
        const size = rng.pick([10, 1000, 3000]);
        const id = rng.pick(IDS);
        names.push(`tab${t} write ${key} size=${size} ${id}`);
        work.push(
          stores[t].write(generation, artifact(key, size, clock++), {
            id,
            threadId: 'thread',
            mailboxId: 'mailbox',
            sourceHash: rng.pick(SOURCES),
            keys: [key],
          })
        );
      } else if (allowRemove) {
        names.push(`tab${t} remove ${key}`);
        work.push(stores[t].remove(key));
      }
    }
    await Promise.all(work);
    return { name: `concurrent [${names.join('; ')}]` };
  }

  try {
    await stores[0].generation();
    for (let i = 0; i < steps; i++) {
      const { name, writer } = await op();
      log.push(name);
      await check(`step ${i} (${name})`, writer);
    }
  } catch (error) {
    if (!(error instanceof Violation)) violations.push(`threw: ${error}`);
  } finally {
    for (const store of stores) store.close();
    vi.unstubAllGlobals();
  }
  return { violations, log };
}

afterEach(() => vi.unstubAllGlobals());

async function fuzz(label: string) {
  const only = process.env.FUZZ_SEED;
  const seeds = only
    ? [Number(only)]
    : Array.from(
        { length: Number(process.env.FUZZ_SEEDS ?? 120) },
        (_, i) => i + 1
      );
  const steps = Number(process.env.FUZZ_STEPS ?? 150);
  const categories = new Map<string, number[]>();
  let first: { seed: number; violations: string[]; log: string[] } | undefined;
  for (const seed of seeds) {
    const result = await runSeed(seed, steps);
    if (!result.violations.length) continue;
    first ??= { seed, ...result };
    for (const violation of result.violations) {
      const category = violation
        .replace(/step \d+ \([^)]*\)/g, 'step N')
        .replace(/\d+/g, 'N');
      const list = categories.get(category) ?? [];
      list.push(seed);
      categories.set(category, list);
    }
  }
  if (first)
    console.error(
      `${label}: ${categories.size} violation kinds\n${[...categories]
        .map(
          ([category, list]) =>
            `  ${list.length}× ${category}\n     seeds: ${list.slice(0, 10).join(', ')}`
        )
        .join(
          '\n'
        )}\nfirst failing seed ${first.seed}: ${first.violations.join(' | ')}\nop log tail:\n${first.log.slice(-25).join('\n')}`
    );
  return [...categories.keys()];
}

describe('IndexedDbArtifacts model-based fuzz', () => {
  it('keeps byte accounting exact, budgets enforced and associations referentially intact', async () => {
    expect(await fuzz('indexeddb fuzz'), 'see console output').toEqual([]);
  }, 120_000);
});
