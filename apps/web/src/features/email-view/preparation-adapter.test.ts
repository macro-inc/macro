import { createRoot, createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePrepareEmailNeighbors } from './preparation-adapter';

const mocks = vi.hoisted(() => ({ cache: vi.fn(), prepare: vi.fn() }));
vi.mock('@app/lib/email-render-cache/session', () => ({
  useEmailRenderCache: () => mocks.cache(),
}));
vi.mock('@app/features/email-thread/preparation-adapter', () => ({
  prepareEmailThreads: mocks.prepare,
}));

describe('navigation preparation lifetimes', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });
  afterEach(() => vi.useRealTimers());
  it('retains overlapping neighbors, bounds the window, and releases on session change or disposal', () => {
    const [service, setService] = createSignal({});
    const [focused, setFocused] = createSignal<string | undefined>('c');
    const releases = new Map<string, ReturnType<typeof vi.fn>>();
    mocks.cache.mockReturnValue(service);
    mocks.prepare.mockImplementation((_service, [id]) => {
      const release = vi.fn();
      releases.set(id, release);
      return release;
    });
    const dispose = createRoot((dispose) => {
      usePrepareEmailNeighbors(
        () => ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
        focused
      );
      return dispose;
    });
    vi.advanceTimersByTime(75);
    expect(mocks.prepare).toHaveBeenCalledTimes(5);
    const first = new Map(releases);
    setFocused('d');
    vi.advanceTimersByTime(75);
    expect(mocks.prepare).toHaveBeenCalledTimes(6);
    expect(first.get('a')).toHaveBeenCalledOnce();
    for (const id of ['b', 'c', 'd', 'e'])
      expect(first.get(id)).not.toHaveBeenCalled();
    setService({});
    for (const id of ['b', 'c', 'd', 'e', 'f'])
      expect(releases.get(id)).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(75);
    dispose();
    for (const id of ['b', 'c', 'd', 'e', 'f'])
      expect(releases.get(id)).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(1000);
    expect(mocks.prepare).toHaveBeenCalledTimes(11);
  });
});
