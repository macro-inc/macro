import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import { createThreadPaginator } from '../thread-paginator';

/** Paging over signals, with older pages loaded by `loadOlder`. */
function paging() {
  const [loadingOlder, setLoadingOlder] = createSignal(false);
  const [hasOlder, setHasOlder] = createSignal(true);
  // Like the timeline's loadMore, it does nothing while another load runs.
  const loadOlder = vi.fn(async () => {});
  const guardedLoadOlder = async () => {
    if (!loadingOlder()) await loadOlder();
  };
  const [target, setTarget] = createSignal<string>();
  let dispose!: () => void;
  const paginator = createRoot((disposeRoot) => {
    dispose = disposeRoot;
    return createThreadPaginator(
      {
        hasOlder,
        hasNewer: () => false,
        isLoadingOlder: loadingOlder,
        isLoadingNewer: () => false,
        loadOlder: guardedLoadOlder,
        loadNewer: async () => {},
      },
      target
    );
  });
  return {
    setLoadingOlder,
    setHasOlder,
    setTarget,
    loadOlder,
    paginator,
    dispose,
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

  it('waits again when another load takes the direction before it resumes', async () => {
    const { setLoadingOlder, loadOlder, paginator } = paging();
    setLoadingOlder(true);
    const asked = paginator.shiftPaginate();
    setLoadingOlder(false);
    setLoadingOlder(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(loadOlder).not.toHaveBeenCalled();

    setLoadingOlder(false);
    await asked;

    expect(loadOlder).toHaveBeenCalledTimes(1);
  });

  it('waits for the direction before a scroll queued behind its own load', async () => {
    const { setLoadingOlder, loadOlder, paginator } = paging();
    let finish!: () => void;
    loadOlder.mockImplementationOnce(
      () => new Promise<void>((resolve) => (finish = resolve))
    );
    const asked = paginator.shiftPaginate();
    await Promise.resolve();
    expect(loadOlder).toHaveBeenCalledTimes(1);
    // A scroll queues behind it, then a window read again takes the direction
    // before that load answers.
    await paginator.shiftPaginate();
    setLoadingOlder(true);
    finish();
    await Promise.resolve();
    await Promise.resolve();
    expect(loadOlder).toHaveBeenCalledTimes(1);

    setLoadingOlder(false);
    await asked;
    expect(loadOlder).toHaveBeenCalledTimes(2);
  });

  it('drops a scroll queued in a window the list has left', async () => {
    const { setTarget, loadOlder, paginator } = paging();
    let finish!: () => void;
    loadOlder.mockImplementationOnce(
      () => new Promise<void>((resolve) => (finish = resolve))
    );
    const asked = paginator.shiftPaginate();
    await Promise.resolve();
    await paginator.shiftPaginate();
    setTarget('search-hit');
    finish();
    await asked;

    expect(loadOlder).toHaveBeenCalledTimes(1);
    expect(paginator.isShifting()).toBe(false);
  });

  it('drops a scroll waiting on a load once the list jumps to a target', async () => {
    const { setLoadingOlder, setTarget, loadOlder, paginator } = paging();
    setLoadingOlder(true);
    const asked = paginator.shiftPaginate();
    setTarget('search-hit');
    setLoadingOlder(false);
    await asked;

    expect(loadOlder).not.toHaveBeenCalled();
  });

  it('pages a scroll queued in the window it jumped to', async () => {
    const { setTarget, loadOlder, paginator } = paging();
    let finish!: () => void;
    loadOlder.mockImplementationOnce(
      () => new Promise<void>((resolve) => (finish = resolve))
    );
    const asked = paginator.shiftPaginate();
    await Promise.resolve();
    setTarget('search-hit');
    await paginator.shiftPaginate();
    finish();
    await asked;

    expect(loadOlder).toHaveBeenCalledTimes(2);
  });

  it('pages a scroll asked in the new window while an old one waits on a load', async () => {
    const { setLoadingOlder, setTarget, loadOlder, paginator } = paging();
    setLoadingOlder(true);
    const asked = paginator.shiftPaginate();
    setTarget('search-hit');
    await paginator.shiftPaginate();
    setLoadingOlder(false);
    await asked;

    expect(loadOlder).toHaveBeenCalledTimes(1);
    expect(paginator.isShifting()).toBe(false);
  });

  it('asks for no queued page once the list goes away', async () => {
    const { loadOlder, paginator, dispose } = paging();
    let finish!: () => void;
    loadOlder.mockImplementationOnce(
      () => new Promise<void>((resolve) => (finish = resolve))
    );
    const asked = paginator.shiftPaginate();
    await Promise.resolve();
    await paginator.shiftPaginate();
    dispose();
    finish();
    await asked;
    expect(loadOlder).toHaveBeenCalledTimes(1);
  });

  it('lets a waiting request go when the list goes away mid-load', async () => {
    const { setLoadingOlder, loadOlder, paginator, dispose } = paging();
    setLoadingOlder(true);
    const asked = paginator.shiftPaginate();

    dispose();
    await asked;

    expect(loadOlder).not.toHaveBeenCalled();
    expect(paginator.isShifting()).toBe(false);
  });
});
