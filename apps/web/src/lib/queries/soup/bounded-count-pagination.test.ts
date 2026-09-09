import { batch, createRoot } from 'solid-js';
import { createStore } from 'solid-js/store';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { boundedCount } from './bounded-count';
import { createBoundedCountPagination } from './bounded-count-pagination';

const disposers: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  vi.restoreAllMocks();
});

function setup(
  initial: string[],
  pages: string[][],
  options: { enabled?: boolean; fail?: boolean; loading?: boolean } = {}
) {
  return createRoot((dispose) => {
    disposers.push(dispose);
    let page = 0;
    const fetchNextPage = vi.fn(async () => {
      setState('isFetching', true);
      await Promise.resolve();
      if (options.fail) {
        const error = new Error('page failed');
        batch(() => {
          setState('error', error);
          setState('isFetching', false);
        });
        throw error;
      }
      const next = pages[page++];
      batch(() => {
        setState('keys', (previous) => [...previous, ...next]);
        setState('hasNextPage', page < pages.length);
        setState('isFetching', false);
      });
    });
    const [query, setState] = createStore({
      keys: initial,
      isEnabled: options.enabled ?? true,
      isLoading: options.loading ?? false,
      isFetching: false,
      isFetchingNextPage: false,
      isPlaceholderData: false,
      error: null as Error | null,
      hasNextPage: pages.length > 0,
      fetchNextPage,
    });
    const count = () => boundedCount(query.keys, !query.hasNextPage);
    createBoundedCountPagination(query, count);
    return { query, setState, count, fetchNextPage };
  });
}

describe('bounded count pagination', () => {
  it('resolves an incomplete first page instead of leaving its badge hidden', async () => {
    const result = setup(['channel'], [['thread']]);
    await vi.waitFor(() => expect(result.count()).toBe(2));
    expect(result.fetchNextPage).toHaveBeenCalledTimes(1);
  });

  it('continues through pages with no matching unread rows', async () => {
    const result = setup([], [[], ['unread']]);
    await vi.waitFor(() => expect(result.count()).toBe(1));
    expect(result.fetchNextPage).toHaveBeenCalledTimes(2);
  });

  it('stops at 99+ even when more pages exist', async () => {
    const result = setup(
      Array.from({ length: 99 }, (_, i) => `${i}`),
      [['100'], ['101']]
    );
    await vi.waitFor(() => expect(result.count()).toBe('99+'));
    expect(result.query.hasNextPage).toBe(true);
    expect(result.fetchNextPage).toHaveBeenCalledTimes(1);
  });

  it('resumes when reading rows takes the count below the cap', async () => {
    const result = setup(
      Array.from({ length: 100 }, (_, i) => `${i}`),
      [['next']]
    );
    expect(result.fetchNextPage).not.toHaveBeenCalled();
    result.setState('keys', ['remaining']);
    await vi.waitFor(() => expect(result.count()).toBe(2));
    expect(result.fetchNextPage).toHaveBeenCalledTimes(1);
  });

  it('waits for initial loading and never overlaps requests', async () => {
    const result = setup([], [['a'], ['b']], { loading: true });
    expect(result.fetchNextPage).not.toHaveBeenCalled();
    result.setState('isLoading', false);
    await vi.waitFor(() => expect(result.count()).toBe(2));
    expect(result.fetchNextPage).toHaveBeenCalledTimes(2);
  });

  it('does not paginate a disabled query or a complete result', () => {
    expect(
      setup([], [['a']], { enabled: false }).fetchNextPage
    ).not.toHaveBeenCalled();
    expect(setup(['a'], []).fetchNextPage).not.toHaveBeenCalled();
  });

  it('does not retry a failed page in a loop', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = setup([], [['a']], { fail: true });
    await vi.waitFor(() => expect(result.query.error).not.toBeNull());
    expect(result.fetchNextPage).toHaveBeenCalledTimes(1);
    expect(result.count()).toBeUndefined();
  });
});
