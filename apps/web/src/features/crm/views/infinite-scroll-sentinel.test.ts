// @vitest-environment jsdom
import { createRoot, createSignal } from 'solid-js';
import { beforeEach, expect, it, vi } from 'vitest';
import { useInfiniteScrollSentinel } from '../../../lib/primitives/infinite-scroll-sentinel';

const observers: {
  trigger: () => void;
  disconnect: ReturnType<typeof vi.fn>;
}[] = [];

beforeEach(() => {
  observers.length = 0;
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      disconnect = vi.fn();
      constructor(private callback: IntersectionObserverCallback) {
        observers.push({
          trigger: () =>
            this.callback(
              [{ isIntersecting: true } as IntersectionObserverEntry],
              this as never
            ),
          disconnect: this.disconnect,
        });
      }
      observe() {}
    }
  );
});

it('fetches again when a completed page leaves the sentinel visible', () => {
  const node = document.createElement('div');
  document.body.append(node);
  const fetch = vi.fn();
  let setFetching!: (value: boolean) => void;
  let setHasNext!: (value: boolean) => void;
  const dispose = createRoot((stop) => {
    const [fetching, updateFetching] = createSignal(false);
    const [hasNext, updateHasNext] = createSignal(true);
    setFetching = updateFetching;
    setHasNext = updateHasNext;
    useInfiniteScrollSentinel({
      sentinel: () => node,
      hasNextPage: hasNext,
      isFetchingNextPage: fetching,
      fetchNextPage: fetch,
    });
    return stop;
  });
  expect(observers).toHaveLength(1);
  observers[0].trigger();
  expect(fetch).toHaveBeenCalledTimes(1);
  setFetching(true);
  observers.at(-1)?.trigger();
  expect(fetch).toHaveBeenCalledTimes(1);
  setFetching(false);
  expect(observers).toHaveLength(2);
  observers[1].trigger();
  expect(fetch).toHaveBeenCalledTimes(2);
  setHasNext(false);
  expect(observers[1].disconnect).toHaveBeenCalled();
  dispose();
  node.remove();
});
