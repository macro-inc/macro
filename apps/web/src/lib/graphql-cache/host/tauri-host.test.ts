import { beforeEach, describe, expect, it, vi } from 'vitest';

const invokeMock = vi.hoisted(() => vi.fn());
const listenMock = vi.hoisted(() => vi.fn());

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
vi.mock('@tauri-apps/api/event', () => ({ listen: listenMock }));

import { createTauriCacheHost } from './tauri-host';

type OpsAffectedPayload = { opIds: string[]; keys: string[] };
type EventCallback = (event: { payload: OpsAffectedPayload }) => void;

describe('createTauriCacheHost', () => {
  let eventCallback: EventCallback | undefined;
  const unlisten = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    eventCallback = undefined;
    invokeMock.mockResolvedValue(null);
    listenMock.mockImplementation((_event: string, cb: EventCallback) => {
      eventCallback = cb;
      return Promise.resolve(unlisten);
    });
  });

  it('initializes the native cache once and prefixes op ids', async () => {
    invokeMock.mockImplementation((command: string) =>
      Promise.resolve(
        command === 'graphql_cache_read' ? { kind: 'miss' } : null
      )
    );
    const host = createTauriCacheHost({ scope: 'scope-1', hotCapacity: 42 });

    const result = await host.readQuery({ opKey: 7, query: '{ x }' });
    expect(result).toEqual({ kind: 'miss' });

    expect(invokeMock).toHaveBeenCalledWith('graphql_cache_init', {
      scope: 'scope-1',
      hotCapacity: 42,
    });
    expect(invokeMock).toHaveBeenCalledWith('graphql_cache_read', {
      opId: `${host.clientId}:7`,
      query: '{ x }',
      operationName: undefined,
      variables: undefined,
    });
  });

  it('sends writes with origin op id and identity', async () => {
    const host = createTauriCacheHost({ scope: 'scope-1' });
    const writeResult = { changed: ['A:1'], affectedOps: [], reset: false };
    invokeMock.mockImplementation((command: string) =>
      Promise.resolve(command === 'graphql_cache_write' ? writeResult : null)
    );

    const result = await host.writeQuery({
      opKey: 3,
      query: '{ x }',
      data: { x: 1 },
      identity: 'user-1',
    });
    expect(result).toEqual(writeResult);
    expect(invokeMock).toHaveBeenCalledWith('graphql_cache_write', {
      originOpId: `${host.clientId}:3`,
      query: '{ x }',
      operationName: undefined,
      variables: undefined,
      data: { x: 1 },
      identity: 'user-1',
    });
  });

  it('settles optimistic writes through the dedicated commands', async () => {
    const host = createTauriCacheHost({ scope: 'scope-1' });
    const optimistic = {
      transactionId: '1',
      changed: ['A:1'],
      affectedOps: [],
      reset: false,
    };
    invokeMock.mockImplementation((command: string) => {
      if (command === 'graphql_cache_begin_optimistic_write') {
        return Promise.resolve(optimistic);
      }
      if (
        command === 'graphql_cache_commit_optimistic_write' ||
        command === 'graphql_cache_rollback_optimistic_write'
      ) {
        return Promise.resolve({ changed: [], affectedOps: [], reset: false });
      }
      return Promise.resolve(null);
    });

    const begun = await host.beginOptimisticWrite({
      query: 'mutation { m }',
      data: { m: 1 },
    });
    expect(begun).toEqual(optimistic);

    const claim = { owner: 'runner', generation: '2' };
    await host.commitOptimisticWrite('1', claim, {
      query: 'mutation { m }',
      data: { m: 2 },
    });
    expect(invokeMock).toHaveBeenCalledWith(
      'graphql_cache_commit_optimistic_write',
      expect.objectContaining({
        transactionId: '1',
        leaseOwner: 'runner',
        leaseGeneration: '2',
        data: { m: 2 },
      })
    );

    await host.rollbackOptimisticWrite('1', claim);
    expect(invokeMock).toHaveBeenCalledWith(
      'graphql_cache_rollback_optimistic_write',
      {
        transactionId: '1',
        leaseOwner: 'runner',
        leaseGeneration: '2',
      }
    );
  });

  it('delivers only own-client op keys from the broadcast event', async () => {
    const host = createTauriCacheHost({ scope: 'scope-1' });
    const seen: number[][] = [];
    host.onOpsAffected((opKeys) => seen.push(opKeys));
    // listen() resolves asynchronously; wait for registration.
    await Promise.resolve();
    expect(listenMock).toHaveBeenCalledWith(
      'graphql-cache://ops-affected',
      expect.any(Function)
    );

    eventCallback?.({
      payload: {
        opIds: [`${host.clientId}:5`, 'other-client:9', `${host.clientId}:8`],
        keys: ['A:1'],
      },
    });
    expect(seen).toEqual([[5, 8]]);

    // No delivery when nothing matches this client.
    eventCallback?.({
      payload: { opIds: ['other-client:9'], keys: ['A:1'] },
    });
    expect(seen).toEqual([[5, 8]]);
  });

  it('normalizes string command errors to Error rejections', async () => {
    const host = createTauriCacheHost({ scope: 'scope-1' });
    invokeMock.mockImplementation((command: string) =>
      command === 'graphql_cache_read'
        ? Promise.reject('engine exploded')
        : Promise.resolve(null)
    );

    await expect(host.readQuery({ query: '{ x }' })).rejects.toThrow(
      'engine exploded'
    );
  });

  it('rejects hung requests after the timeout', async () => {
    vi.useFakeTimers();
    try {
      const host = createTauriCacheHost({
        scope: 'scope-1',
        requestTimeoutMs: 50,
      });
      invokeMock.mockImplementation((command: string) =>
        command === 'graphql_cache_init'
          ? Promise.resolve(null)
          : new Promise(() => {})
      );

      const read = host.readQuery({ query: '{ x }' });
      const assertion = expect(read).rejects.toThrow(
        'graphql cache ipc timeout: graphql_cache_read'
      );
      await vi.advanceTimersByTimeAsync(60);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it('tolerates a failed listener setup (no unhandled rejection)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      listenMock.mockRejectedValue(new Error('listen exploded'));
      const host = createTauriCacheHost({ scope: 'scope-1' });
      // Flush the rejection through the catch handler.
      await Promise.resolve();
      await Promise.resolve();
      expect(warn).toHaveBeenCalledWith(
        'graphql cache ops-affected listener failed',
        expect.any(Error)
      );
      // dispose must not throw or re-reject.
      host.dispose();
      await Promise.resolve();
    } finally {
      warn.mockRestore();
    }
  });

  it('unsubscribes the event listener on dispose', async () => {
    const host = createTauriCacheHost({ scope: 'scope-1' });
    await Promise.resolve();
    host.dispose();
    await Promise.resolve();
    expect(unlisten).toHaveBeenCalled();
  });
});
