import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import { createThreadPaginator } from '../thread-paginator';

/** Paging over signals, with older pages loaded by `loadOlder`. */
function paging() {
  const [loadingOlder, setLoadingOlder] = createSignal(false);
  const [hasOlder, setHasOlder] = createSignal(true);
  const loadOlder = vi.fn(async () => {});
  return {
    setLoadingOlder,
    setHasOlder,
    loadOlder,
    paginator: createRoot(() =>
      createThreadPaginator({
        hasOlder,
        hasNewer: () => false,
        isLoadingOlder: loadingOlder,
        isLoadingNewer: () => false,
        loadOlder,
        loadNewer: async () => {},
      })
    ),
  };
}

describe('createThreadPaginator', () => {
  it('pages once a load it did not start lets go', async () => {
    const { setLoadingOlder, loadOlder, paginator } = paging();
    setLoadingOlder(true);
    const asked = paginator.shiftPaginate();
    await Promise.resolve();
    expect(loadOlder).not.toHaveBeenCalled();
    expect(paginator.isShifting()).toBe(true);

    setLoadingOlder(false);
    await asked;

    expect(loadOlder).toHaveBeenCalledTimes(1);
    expect(paginator.isShifting()).toBe(false);
  });

  it('does not page when that load leaves nothing older', async () => {
    const { setLoadingOlder, setHasOlder, loadOlder, paginator } = paging();
    setLoadingOlder(true);
    const asked = paginator.shiftPaginate();
    setHasOlder(false);
    setLoadingOlder(false);
    await asked;

    expect(loadOlder).not.toHaveBeenCalled();
    expect(paginator.hasMoreShifting()).toBe(false);
  });
});
