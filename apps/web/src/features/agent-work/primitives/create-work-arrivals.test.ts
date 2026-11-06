import { createRoot, createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createWorkArrivals } from './create-work-arrivals';

const flush = () => Promise.resolve();

describe('createWorkArrivals', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function setup(announceInitial?: boolean) {
    const [loaded, setLoaded] = createSignal(false);
    const [accounts, setAccounts] = createSignal<readonly string[]>([]);
    const dispose = { run: () => {} };
    const arrivals = createRoot((disposer) => {
      dispose.run = disposer;
      return createWorkArrivals({
        loaded,
        accountsWithWork: accounts,
        announceInitial,
        durationMs: 1_000,
      });
    });
    return { arrivals, setLoaded, setAccounts, dispose };
  }

  it('does not announce work already there when the list loads', async () => {
    const { arrivals, setLoaded, setAccounts, dispose } = setup();
    setAccounts(['a']);
    setLoaded(true);
    await flush();

    expect(arrivals.arrivals()).toEqual([]);
    dispose.run();
  });

  it('announces an account that starts working, then lets it go', async () => {
    const { arrivals, setLoaded, setAccounts, dispose } = setup();
    setLoaded(true);
    await flush();
    setAccounts(['a']);
    await flush();
    expect(arrivals.arrivals()).toEqual(['a']);

    vi.advanceTimersByTime(1_000);
    expect(arrivals.arrivals()).toEqual([]);
    dispose.run();
  });

  it('announces again only after the work has gone away', async () => {
    const { arrivals, setLoaded, setAccounts, dispose } = setup();
    setLoaded(true);
    await flush();
    setAccounts(['a']);
    await flush();
    arrivals.dismiss();

    setAccounts(['a']);
    await flush();
    expect(arrivals.arrivals()).toEqual([]);

    setAccounts([]);
    await flush();
    setAccounts(['a']);
    await flush();
    expect(arrivals.arrivals()).toEqual(['a']);
    dispose.run();
  });

  it('announces existing work on load when asked to', async () => {
    const { arrivals, setLoaded, setAccounts, dispose } = setup(true);
    setAccounts(['a']);
    setLoaded(true);
    await flush();

    expect(arrivals.arrivals()).toEqual(['a']);
    dispose.run();
  });
});
