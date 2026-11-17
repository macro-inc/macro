import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it } from 'vitest';
import { isFocusListNarrowed, trackFocusTabVisits } from './focus-analytics';

type Payload = Parameters<Parameters<typeof trackFocusTabVisits>[1]>[0];

function visitHarness() {
  const [showing, setShowing] = createSignal(false);
  const [loaded, setLoaded] = createSignal(false);
  const [rows, setRows] = createSignal(0);
  const tracked: Payload[] = [];
  const dispose = createRoot((dispose) => {
    trackFocusTabVisits(
      {
        showing,
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
  return { setShowing, setLoaded, setRows, tracked, dispose };
}

describe('trackFocusTabVisits', () => {
  it('counts a visit once, when its list has loaded', () => {
    const visit = visitHarness();
    visit.setShowing(true);
    expect(visit.tracked).toEqual([]);
    visit.setRows(3);
    visit.setLoaded(true);
    expect(visit.tracked).toEqual([
      { rows: 3, threads: 5, narrowed: false, sort: 'recent' },
    ]);
    // A refetch or a new thread is the same visit.
    visit.setLoaded(false);
    visit.setLoaded(true);
    visit.setRows(4);
    expect(visit.tracked).toHaveLength(1);
    visit.dispose();
  });

  it('counts an empty tab as zero rows', () => {
    const visit = visitHarness();
    visit.setLoaded(true);
    visit.setShowing(true);
    expect(visit.tracked).toEqual([
      { rows: 0, threads: 2, narrowed: false, sort: 'recent' },
    ]);
    visit.dispose();
  });

  it('counts each return to the tab as a new visit', () => {
    const visit = visitHarness();
    visit.setLoaded(true);
    visit.setShowing(true);
    visit.setShowing(false);
    visit.setShowing(true);
    expect(visit.tracked).toHaveLength(2);
    visit.dispose();
  });

  it('does not count a visit that ends before the list loads', () => {
    const visit = visitHarness();
    visit.setShowing(true);
    visit.setShowing(false);
    visit.setLoaded(true);
    expect(visit.tracked).toEqual([]);
    visit.dispose();
  });
});

describe('isFocusListNarrowed', () => {
  const whole = { search: '', inboxIds: undefined, facets: {} };

  it('is false for the whole list', () => {
    expect(isFocusListNarrowed(whole)).toBe(false);
    expect(isFocusListNarrowed({ ...whole, facets: { tags: [] } })).toBe(false);
  });

  it('is true for a search, a filter or an inbox choice', () => {
    expect(isFocusListNarrowed({ ...whole, search: 'plan' })).toBe(true);
    expect(isFocusListNarrowed({ ...whole, facets: { tags: ['a'] } })).toBe(
      true
    );
    expect(isFocusListNarrowed({ ...whole, inboxIds: ['inbox-a'] })).toBe(true);
  });
});
