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
    await expect(
      host.readRecords({
        document: 'fragment Item on GraphqlSoupItem { id }',
        fragmentName: 'Item',
        limit: 20,
      })
    ).resolves.toEqual({ records: [], nextCursor: null });
  });

  it('round-trips generated query inspection through the worker protocol', async () => {
    const requests: unknown[] = [];
    const variants = [{ variables: { input: { initial: { limit: 20 } } } }];
    const instances = variants.map((variant) => ({
      ...variant,
      value: { bins: [] },
    }));
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
                result:
                  request.kind === 'inspect-query'
                    ? instances
                    : request.kind === 'inspect-query-variants'
                      ? variants
                      : null,
              },
            } as MessageEvent);
          });
        },
      };
    }
    vi.stubGlobal('SharedWorker', FakeSharedWorker);
    const host = createWorkerCacheHost({ scope: 'scope-1' });
    const variantRequest = {
      query:
        'query Views($input: GroupedSoupInput!) { user { groupSoup(input: $input) { bins { key } } } }',
      operationName: 'Views',
      path: [{ field: 'user' }, { field: 'groupSoup' }],
    };
    const request = {
      ...variantRequest,
      variableFilters: [
        { input: { initial: { groupBy: { field: 'PROPERTY' } } } },
      ],
    };

    await expect(host.inspectQueryVariants(variantRequest)).resolves.toEqual(
      variants
    );
    expect(requests).toContainEqual(
      expect.objectContaining({
        kind: 'inspect-query-variants',
        ...variantRequest,
      })
    );
    expect(
      requests.find(
        (candidate) =>
          (candidate as { kind?: string }).kind === 'inspect-query-variants'
      )
    ).not.toHaveProperty('variableFilters');
    await expect(host.inspectQuery(request)).resolves.toEqual(instances);
    expect(requests).toContainEqual(
      expect.objectContaining({ kind: 'inspect-query', ...request })
    );
    host.dispose();
  });

  it('forwards user-visible read priority to the worker', async () => {
    const requests: Array<{ id?: number; kind: string; priority?: string }> =
      [];
    class FakeSharedWorker {
      port = {
        onmessage: null as ((event: MessageEvent) => void) | null,
        start() {},
        close() {},
        postMessage: (request: {
          id?: number;
          kind: string;
          priority?: string;
        }) => {
          requests.push(request);
          if (request.id === undefined) return;
          queueMicrotask(() => {
            this.port.onmessage?.({
              data: {
                id: request.id,
                ok: true,
                result:
                  request.kind === 'read'
                    ? { kind: 'hit', data: { soup: true } }
                    : null,
              },
            } as MessageEvent);
          });
        },
      };
    }
    vi.stubGlobal('SharedWorker', FakeSharedWorker);
    const host = createWorkerCacheHost({ scope: 'scope-1' });
    const entityResolvers = [
      {
        parentType: 'GraphqlUser',
        fieldName: 'emailThread',
        targetType: 'GraphqlSoupEmailThread',
        argumentPath: ['input', 'threadId'],
      },
    ];

    await expect(
      host.readQuery({
        opKey: 7,
        query: 'query GroupSoup { groupSoup }',
        priority: 'user-visible',
        entityResolvers,
      })
    ).resolves.toEqual({ kind: 'hit', data: { soup: true } });
    expect(requests).toContainEqual(
      expect.objectContaining({
        kind: 'read',
        priority: 'user-visible',
        entityResolvers,
      })
    );
    host.dispose();
  });

  it('delivers queued mutation settlements pushed by the worker', async () => {
    let push: (message: unknown) => void = () => {
      throw new Error('worker not initialized');
    };
    class FakeSharedWorker {
      port = {
        onmessage: null as ((event: MessageEvent) => void) | null,
        start() {},
        close() {},
        postMessage: (request: { id?: number }) => {
          if (request.id === undefined) return;
          queueMicrotask(() => {
            this.port.onmessage?.({
              data: { id: request.id, ok: true, result: null },
            } as MessageEvent);
          });
        },
      };

      constructor() {
        push = (message) =>
          this.port.onmessage?.({ data: message } as MessageEvent);
      }
    }
    vi.stubGlobal('SharedWorker', FakeSharedWorker);
    const host = createWorkerCacheHost({ scope: 'scope-1' });
    const seen: unknown[] = [];
    host.onMutationSettled((settlement) => seen.push(settlement));
    const settlement = {
      transactionId: '12',
      status: 'committed' as const,
    };

    push({ kind: 'mutation-settled', settlement });

    expect(seen).toEqual([settlement]);
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
    const mutationResult = host.enqueueOptimisticMutation(
      {
        query: 'mutation Rename { rename { id } }',
        data: { rename: { id: 'doc-1' } },
      },
      {
        owner: 'runner-1',
        nowMs: 123,
        leaseExpiresAtMs: 1_123,
      }
    );
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
      requests.filter(
        (request) => request.kind === 'enqueue-optimistic-mutation'
      )
    ).toHaveLength(1);

    const mutationRequest = requests.find(
      (request) => request.kind === 'enqueue-optimistic-mutation'
    );
    expect(mutationRequest).toEqual(
      expect.objectContaining({
        owner: 'runner-1',
        nowMs: 123,
        createdAtMs: 123,
        leaseExpiresAtMs: 1_123,
      })
    );
    expect(mutationRequest?.id).toBeTypeOf('number');
    const result = {
      transactionId: '1',
      changed: [],
      affectedOps: [],
      reset: false,
      initialClaim: { kind: 'not-runnable' as const },
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
