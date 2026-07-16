import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWorkerCacheHost } from './worker-host';

describe('createWorkerCacheHost', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('uses a storage-free no-op host when SharedWorker is unavailable', async () => {
    const worker = vi.fn();
    vi.stubGlobal('SharedWorker', undefined);
    vi.stubGlobal('Worker', worker);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const host = createWorkerCacheHost({ scope: 'scope-1' });

    expect(warn).toHaveBeenCalledWith(
      '[graphql-cache] disabled: SharedWorker is not supported by this browser'
    );
    expect(worker).not.toHaveBeenCalled();
    expect(host.disabled).toBe(true);
    await expect(host.readQuery({ query: '{ x }' })).resolves.toEqual({
      kind: 'miss',
    });
    await expect(
      host.writeQuery({ query: '{ x }', data: { x: 1 } })
    ).resolves.toEqual({ changed: [], affectedOps: [], reset: false });
  });

  it('round-trips generated query inspection through the worker protocol', async () => {
    const requests: unknown[] = [];
    const instances = [
      { variables: { input: { initial: { limit: 20 } } }, value: { bins: [] } },
    ];
    class FakeSharedWorker {
      port = {
        onmessage: null as ((event: MessageEvent) => void) | null,
        start() {},
        close() {},
        postMessage: (request: { id?: number; kind: string }) => {
          requests.push(request);
          if (request.id === undefined) return;
          queueMicrotask(() => {
            this.port.onmessage?.({
              data: {
                id: request.id,
                ok: true,
                result: request.kind === 'inspect-query' ? instances : null,
              },
            } as MessageEvent);
          });
        },
      };
    }
    vi.stubGlobal('SharedWorker', FakeSharedWorker);
    const host = createWorkerCacheHost({ scope: 'scope-1' });
    const request = {
      query:
        'query Views($input: GroupedSoupInput!) { user { groupSoup(input: $input) { bins { key } } } }',
      operationName: 'Views',
      path: [{ field: 'user' }, { field: 'groupSoup' }],
    };

    await expect(host.inspectQuery(request)).resolves.toEqual(instances);
    expect(requests).toContainEqual(
      expect.objectContaining({ kind: 'inspect-query', ...request })
    );
    host.dispose();
  });

  it('times out reads without timing out durable mutations', async () => {
    vi.useFakeTimers();
    const requests: Array<{ id?: number; kind: string }> = [];
    let respond: (id: number, result: unknown) => void = () => {
      throw new Error('worker not initialized');
    };
    class FakeSharedWorker {
      port = {
        onmessage: null as ((event: MessageEvent) => void) | null,
        start() {},
        close() {},
        postMessage: (request: { id?: number; kind: string }) => {
          requests.push(request);
          if (request.id === undefined) return;
          if (request.kind === 'init') {
            queueMicrotask(() =>
              this.port.onmessage?.({
                data: { id: request.id, ok: true, result: null },
              } as MessageEvent)
            );
          }
        },
      };

      constructor() {
        respond = (id, result) =>
          this.port.onmessage?.({
            data: { id, ok: true, result },
          } as MessageEvent);
      }
    }
    vi.stubGlobal('SharedWorker', FakeSharedWorker);
    const host = createWorkerCacheHost({
      scope: 'scope-1',
      requestTimeoutMs: 10,
    });

    const readResult = expect(
      host.readQuery({ query: 'query Read { user { id } }' })
    ).rejects.toThrow('cache worker timeout: read');
    const mutationResult = host.beginOptimisticWrite({
      query: 'mutation Rename { rename { id } }',
      data: { rename: { id: 'doc-1' } },
    });
    let mutationSettled = false;
    void mutationResult.then(
      () => {
        mutationSettled = true;
      },
      () => {
        mutationSettled = true;
      }
    );

    await vi.advanceTimersByTimeAsync(11);
    await readResult;
    expect(mutationSettled).toBe(false);
    expect(
      requests.filter((request) => request.kind === 'begin-optimistic-write')
    ).toHaveLength(1);

    const mutationRequest = requests.find(
      (request) => request.kind === 'begin-optimistic-write'
    );
    expect(mutationRequest?.id).toBeTypeOf('number');
    const result = {
      transactionId: '1',
      changed: [],
      affectedOps: [],
      reset: false,
    };
    respond(mutationRequest?.id as number, result);
    await expect(mutationResult).resolves.toEqual(result);
    host.dispose();
  });

  it('falls back to no-op when SharedWorker initialization throws', () => {
    vi.stubGlobal(
      'SharedWorker',
      vi.fn(function () {
        throw new Error('blocked');
      })
    );
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const host = createWorkerCacheHost({ scope: 'scope-1' });

    expect(host.disabled).toBe(true);
    expect(warn).toHaveBeenCalledWith(
      '[graphql-cache] disabled: SharedWorker could not be initialized'
    );
  });
});
