import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWorkerCacheHost } from './worker-host';

describe('createWorkerCacheHost', () => {
  afterEach(() => {
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
