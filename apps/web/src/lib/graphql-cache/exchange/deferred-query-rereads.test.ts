import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDeferredQueryRereads } from './deferred-query-rereads';

let visibility: DocumentVisibilityState;
function setVisibility(value: DocumentVisibilityState) {
  visibility = value;
  document.dispatchEvent(new Event('visibilitychange'));
}

beforeEach(() => {
  visibility = 'visible';
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(
    () => visibility
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  setVisibility('visible');
  vi.restoreAllMocks();
});

describe('deferred query rereads', () => {
  it('runs immediately without a listener when visible', () => {
    const listen = vi.spyOn(document, 'addEventListener');
    const run = vi.fn();
    const queue = createDeferredQueryRereads(run);
    queue.request(1);
    queue.request(2, true);
    expect(run.mock.calls).toEqual([
      [1, false],
      [2, true],
    ]);
    expect(listen).not.toHaveBeenCalled();
  });

  it('coalesces hidden updates per operation and unregisters after catch-up', () => {
    setVisibility('hidden');
    const listen = vi.spyOn(document, 'addEventListener');
    const unlisten = vi.spyOn(document, 'removeEventListener');
    const run = vi.fn();
    const queue = createDeferredQueryRereads(run);
    for (let i = 0; i < 20; i++) queue.request(1);
    queue.request(2, true);
    expect(run).not.toHaveBeenCalled();
    expect(listen).toHaveBeenCalledOnce();
    setVisibility('hidden');
    expect(run).not.toHaveBeenCalled();

    setVisibility('visible');
    expect(run.mock.calls).toEqual([
      [1, false],
      [2, true],
    ]);
    expect(unlisten).toHaveBeenCalledOnce();
    setVisibility('visible');
    expect(run).toHaveBeenCalledTimes(2);
  });

  it.each([
    [true, false],
    [false, true],
  ])('keeps ordinary invalidation across %s then %s', (first, second) => {
    setVisibility('hidden');
    const run = vi.fn();
    const queue = createDeferredQueryRereads(run);
    queue.request(1, first);
    queue.request(1, second);
    setVisibility('visible');
    expect(run).toHaveBeenCalledExactlyOnceWith(1, false);
  });

  it('consumes pending work if a visible push arrives before visibilitychange', () => {
    setVisibility('hidden');
    const run = vi.fn();
    const queue = createDeferredQueryRereads(run);
    queue.request(1);
    visibility = 'visible';
    queue.request(1, true);
    expect(run).toHaveBeenCalledExactlyOnceWith(1, false);
    setVisibility('visible');
    expect(run).toHaveBeenCalledOnce();
  });

  it('forgets unmounted operations and their registration intent', () => {
    setVisibility('hidden');
    const unlisten = vi.spyOn(document, 'removeEventListener');
    const run = vi.fn();
    const queue = createDeferredQueryRereads(run);
    queue.request(1);
    queue.forget(1);
    expect(unlisten).toHaveBeenCalledOnce();
    setVisibility('visible');
    expect(run).not.toHaveBeenCalled();
    queue.request(1, true);
    expect(run).toHaveBeenCalledExactlyOnceWith(1, true);
  });

  it('leaves later operations pending if the page hides during catch-up', () => {
    setVisibility('hidden');
    const run = vi.fn((key: number) => {
      if (key === 1) setVisibility('hidden');
    });
    const queue = createDeferredQueryRereads(run);
    queue.request(1);
    queue.request(2);
    setVisibility('visible');
    expect(run).toHaveBeenCalledExactlyOnceWith(1, false);
    setVisibility('visible');
    expect(run).toHaveBeenLastCalledWith(2, false);
  });

  it('runs without browser visibility in non-page environments', () => {
    vi.stubGlobal('document', undefined);
    const run = vi.fn();
    createDeferredQueryRereads(run).request(1);
    expect(run).toHaveBeenCalledExactlyOnceWith(1, false);
  });
});
