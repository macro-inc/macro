import { batch, createRoot, createSignal } from 'solid-js';
import { describe, expect, it } from 'vitest';
import { isFocusListNarrowed, trackFocusTabVisits } from './focus-analytics';

type Payload = Parameters<Parameters<typeof trackFocusTabVisits>[1]>[0];

function visitHarness() {
  const [showing, setShowing] = createSignal(false);
  const [fetching, setFetching] = createSignal(false);
  const [failed, setFailed] = createSignal(false);
  const [loaded, setLoaded] = createSignal(false);
  const [rows, setRows] = createSignal(0);
  const tracked: Payload[] = [];
  const dispose = createRoot((dispose) => {
    trackFocusTabVisits(
      {
        showing,
        fetching,
        failed,
        loaded,
        threads: () => rows() + 2,
        rows,
        narrowed: () => false,
        sort: () => 'recent',
      },
      (payload) => tracked.push(payload)
    );
    return dispose;
  });
  /** Opens the tab and runs its read to the end with `count` rows. */
  const visit = (count: number, outcome: 'ok' | 'failed' = 'ok') => {
    batch(() => {
      setShowing(true);
      setFetching(true);
    });
    batch(() => {
      setRows(count);
      setFailed(outcome === 'failed');
      setLoaded(true);
      setFetching(false);
    });
  };
  return { setShowing, setFetching, setRows, visit, tracked, dispose };
}

describe('trackFocusTabVisits', () => {
  it('counts a visit once, when its read returns', () => {
    const tab = visitHarness();
    tab.visit(3);
    expect(tab.tracked).toEqual([
      { rows: 3, threads: 5, narrowed: false, sort: 'recent' },
    ]);
    // A refresh or a new thread is the same visit.
    tab.setFetching(true);
    tab.setRows(4);
    tab.setFetching(false);
    expect(tab.tracked).toHaveLength(1);
    tab.dispose();
  });

  it('counts an empty tab as zero rows', () => {
    const tab = visitHarness();
    tab.visit(0);
    expect(tab.tracked).toEqual([
      { rows: 0, threads: 2, narrowed: false, sort: 'recent' },
    ]);
    tab.dispose();
  });

  it('reports a return visit with its own read, not the rows kept from the last', () => {
    const tab = visitHarness();
    tab.visit(0);
    tab.setShowing(false);
    // The kept rows are loaded before the new read starts.
    tab.setShowing(true);
    expect(tab.tracked).toHaveLength(1);
    tab.setFetching(true);
    tab.setRows(6);
    tab.setFetching(false);
    expect(tab.tracked.map((payload) => payload.rows)).toEqual([0, 6]);
    tab.dispose();
  });

  it('does not count a visit that ends before its read returns', () => {
    const tab = visitHarness();
    tab.setShowing(true);
    tab.setFetching(true);
    tab.setShowing(false);
    tab.setFetching(false);
    expect(tab.tracked).toEqual([]);
    tab.dispose();
  });

  it('does not count a visit whose read fails', () => {
    const tab = visitHarness();
    tab.visit(2, 'failed');
    expect(tab.tracked).toEqual([]);
    tab.dispose();
  });
});

describe('isFocusListNarrowed', () => {
  const whole = { search: '', inboxIds: undefined, facets: {} };

  it('is false for the whole list', () => {
    expect(isFocusListNarrowed(whole)).toBe(false);
    expect(isFocusListNarrowed({ ...whole, facets: { tags: [] } })).toBe(false);
  });

  it('ignores Read status and Done, which Focus does not filter by', () => {
    expect(
      isFocusListNarrowed({
        ...whole,
        facets: { read: ['unread'], done: ['x'] },
      })
    ).toBe(false);
  });

  it('is true for a search, a filter or an inbox choice', () => {
    expect(isFocusListNarrowed({ ...whole, search: 'plan' })).toBe(true);
    expect(isFocusListNarrowed({ ...whole, facets: { tags: ['a'] } })).toBe(
      true
    );
    expect(isFocusListNarrowed({ ...whole, inboxIds: ['inbox-a'] })).toBe(true);
  });
});
