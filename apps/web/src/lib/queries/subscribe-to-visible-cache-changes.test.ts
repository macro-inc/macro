import type { CacheHost } from '@graphql-cache/host/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { subscribeToVisibleCacheChanges } from './subscribe-to-visible-cache-changes';

let visibility: DocumentVisibilityState;
let dispose: (() => void) | undefined;

function setVisibility(value: DocumentVisibilityState) {
  visibility = value;
  document.dispatchEvent(new Event('visibilitychange'));
}

function setup() {
  let notify = () => {};
  const unsubscribe = vi.fn();
  const host = {
    onCacheChanged: vi.fn((callback: () => void) => {
      notify = callback;
      return unsubscribe;
    }),
  } satisfies Pick<CacheHost, 'onCacheChanged'>;
  const refresh = vi.fn();
  dispose = subscribeToVisibleCacheChanges(host, refresh);
  return { host, notify, refresh, unsubscribe };
}

beforeEach(() => {
  vi.useFakeTimers();
  visibility = 'visible';
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(
    () => visibility
  );
});
afterEach(() => {
  dispose?.();
  dispose = undefined;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('subscribeToVisibleCacheChanges', () => {
  it('retains leading/trailing throttling and hydration updates when visible', () => {
    const { host, notify, refresh } = setup();
    expect(host.onCacheChanged).toHaveBeenCalledWith(expect.any(Function), {
      includeHydration: true,
    });
    notify();
    expect(refresh).toHaveBeenCalledOnce();
    notify();
    notify();
    vi.advanceTimersByTime(249);
    expect(refresh).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(1);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('coalesces hidden notifications into one immediate catch-up on visibility', () => {
    setVisibility('hidden');
    const { notify, refresh } = setup();
    for (let i = 0; i < 20; i++) notify();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(1000);
    expect(refresh).not.toHaveBeenCalled();

    setVisibility('visible');
    expect(refresh).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(1000);
    expect(refresh).toHaveBeenCalledOnce();
    setVisibility('hidden');
    setVisibility('visible');
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('retains a pending trailing refresh when the tab becomes hidden', () => {
    const { notify, refresh } = setup();
    notify();
    notify();
    setVisibility('hidden');
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(1000);
    expect(refresh).toHaveBeenCalledOnce();

    setVisibility('visible');
    expect(refresh).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(1000);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('checks visibility again when a scheduled callback runs', () => {
    const { notify, refresh } = setup();
    notify();
    notify();
    // Model the visibility event arriving after the timer fires.
    visibility = 'hidden';
    vi.advanceTimersByTime(250);
    expect(refresh).toHaveBeenCalledOnce();
    setVisibility('visible');
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('keeps changes arriving after a catch-up refresh', () => {
    const { notify, refresh } = setup();
    setVisibility('hidden');
    notify();
    setVisibility('visible');
    notify();
    vi.advanceTimersByTime(250);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('does not refresh a clean tab when it becomes visible', () => {
    const { refresh } = setup();
    setVisibility('hidden');
    setVisibility('visible');
    vi.advanceTimersByTime(1000);
    expect(refresh).not.toHaveBeenCalled();
  });

  it.each(['hidden', 'visible'] as const)(
    'disposes notifications, visibility handling, and timers while %s',
    (state) => {
      const { notify, refresh, unsubscribe } = setup();
      setVisibility(state);
      notify();
      notify();
      dispose?.();
      dispose = undefined;
      expect(unsubscribe).toHaveBeenCalledOnce();
      const count = refresh.mock.calls.length;
      notify();
      setVisibility('hidden');
      setVisibility('visible');
      vi.advanceTimersByTime(1000);
      expect(refresh).toHaveBeenCalledTimes(count);
      expect(vi.getTimerCount()).toBe(0);
    }
  );
});
