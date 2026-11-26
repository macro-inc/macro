import { describe, expect, it, vi } from 'vitest';
import { testAuthority } from '../authority-fixture';
import type { CacheRequest } from '../protocol';

const loadCacheWasmMock = vi.hoisted(() => vi.fn());

vi.mock('./wasm-module', () => ({
  loadCacheWasm: async () => {
    const module = await loadCacheWasmMock();
    return {
      ...module,
      openCache: async (...args: unknown[]) => ({
        currentAuthority: async (identity: string) => testAuthority(identity),
        ...(await module.openCache(...args)),
      }),
    };
  },
}));

import { runnableIndexes } from './operation-order';
import {
  expectedRegistered,
  recordingEngine,
  run,
  scenario,
  violations,
} from './operation-order-fixture';
import { CacheWorkerCore } from './worker-core';

const SEEDS = 400;

const read = (id: number, opId: string, visible = false): CacheRequest => ({
  id,
  kind: 'read',
  opId,
  query: `query Q { ${opId.replace(':', '_')} }`,
  ...(visible ? { priority: 'user-visible' as const } : {}),
});
const teardown = (id: number, opId: string): CacheRequest => ({
  id,
  kind: 'teardown',
  opId,
});
const queued = (requests: CacheRequest[]) =>
  requests.map((request) => ({ request }));

async function order(requests: CacheRequest[]) {
  const recording = recordingEngine();
  loadCacheWasmMock.mockResolvedValue({
    openCache: vi.fn().mockResolvedValue(recording.engine),
  });
  await run(new CacheWorkerCore(), recording, requests);
  return recording.events.map((event) =>
    event.kind === 'read' || event.kind === 'teardown'
      ? `${event.kind}:${event.op}`
      : event.kind
  );
}

describe('runnableIndexes', () => {
  it('holds requests about an operation behind its teardown, and its teardown behind them', () => {
    expect(
      runnableIndexes(
        queued([
          read(1, 'a'),
          read(2, 'b'),
          teardown(3, 'a'),
          read(4, 'a'),
          read(5, 'c'),
          teardown(6, 'a'),
        ]),
        6
      )
    ).toEqual([0, 1, 0, 0, 4, 0]);
  });

  it('holds a teardown with nothing ahead about its operation back from nothing', () => {
    expect(
      runnableIndexes(queued([read(1, 'b'), teardown(2, 'a'), read(3, 'a')]), 3)
    ).toEqual([0, 1, 1]);
  });
});

describe('operation teardown order', () => {
  it('lets requests about other operations pass a teardown', async () => {
    expect(
      await order([
        read(10, 'client:list-1'),
        read(11, 'client:list-2'),
        teardown(12, 'client:gone'),
        read(13, 'client:visible', true),
      ])
    ).toEqual([
      'read:client:visible',
      'read:client:list-1',
      'read:client:list-2',
      'teardown:client:gone',
    ]);
  });

  it("runs a remount's visible read, and what it waits for, ahead of other reads", async () => {
    expect(
      await order([
        read(10, 'client:list-1'),
        read(11, 'client:view'),
        read(12, 'client:list-2'),
        teardown(13, 'client:view'),
        read(14, 'client:view', true),
      ])
    ).toEqual([
      'read:client:view',
      'teardown:client:view',
      'read:client:view',
      'read:client:list-1',
      'read:client:list-2',
    ]);
  });

  it('keeps, for random queues, every request between its operation’s teardowns and lifecycle barriers, and writes in order', async () => {
    for (let seed = 1; seed <= SEEDS; seed += 1) {
      const { requests } = scenario(seed);
      const recording = recordingEngine();
      loadCacheWasmMock.mockResolvedValue({
        openCache: vi.fn().mockResolvedValue(recording.engine),
      });
      await run(new CacheWorkerCore(), recording, requests);
      expect(violations(requests, recording.events), `seed ${seed}`).toEqual(
        []
      );
      expect([...recording.registered].sort(), `seed ${seed}`).toEqual(
        expectedRegistered(requests)
      );
    }
  });
});
