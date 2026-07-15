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
