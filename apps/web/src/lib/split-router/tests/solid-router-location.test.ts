import { createSignal, startTransition } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSolidRouterLocation } from '../integrations/solid-router';
import { createLocationSync } from '../location-sync';
import { createRoutesManifest, decodeRoute } from '../routes';
import type { SplitRouterExternalLocationValue } from '../types';
import { parseExternalLocation } from '../url';

const disposers: Array<() => void> = [];

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  vi.useRealTimers();
});

function setup() {
  vi.useFakeTimers();
  const [external, setExternal] =
    createSignal<SplitRouterExternalLocationValue>(
      parseExternalLocation('/item/current')
    );
  const navigate = vi.fn((url: string, options: { state?: unknown }) => {
    setExternal({ ...parseExternalLocation(url), state: options.state });
  });
  const location = createSolidRouterLocation({
    pathname: () => external().pathname,
    search: () => external().search,
    hash: () => external().hash,
    state: () => external().state,
    navigate,
  });
  const listener = vi.fn();
  const unsubscribe = location.subscribe(listener);
  disposers.push(unsubscribe);
  const commit = (url: string) =>
    location.commit(parseExternalLocation(url), { history: 'push' });
  return {
    external,
    setExternal,
    navigate,
    location,
    listener,
    commit,
    unsubscribe,
  };
}

describe('deferred Solid Router location commits', () => {
  it('cancels pending commits on Back after reconnecting subscribers', async () => {
    const { external, setExternal, navigate, location, commit, unsubscribe } =
      setup();
    const original = external();
    unsubscribe();
    setExternal(parseExternalLocation('/item/away'));
    const listener = vi.fn();
    disposers.push(location.subscribe(listener));

    commit('/item/queued');
    setExternal(original);
    await vi.runAllTimersAsync();

    expect(navigate).not.toHaveBeenCalled();
    expect(external()).toEqual(original);
    expect(listener).toHaveBeenLastCalledWith(original);
  });

  it.each([
    parseExternalLocation('/item/back'),
    parseExternalLocation('/item/current?filter=unread'),
    parseExternalLocation('/item/current#message'),
    {
      ...parseExternalLocation('/item/current'),
      state: { __macroSplitRouter: { entries: [{ key: 'older-entry' }] } },
    },
  ])(
    'cancels pending commits when external navigation changes to %j',
    async (back) => {
      const { external, setExternal, navigate, listener, commit } = setup();
      commit('/item/first');
      commit('/item/second');

      setExternal(back);
      await vi.runAllTimersAsync();

      expect(navigate).not.toHaveBeenCalled();
      expect(external()).toEqual(back);
      expect(listener).toHaveBeenLastCalledWith(back);

      commit('/item/fresh');
      await vi.runAllTimersAsync();
      expect(navigate).toHaveBeenCalledExactlyOnceWith('/item/fresh', {
        replace: false,
        state: undefined,
      });
    }
  );

  it.each(['synchronous', 'transition'])(
    'preserves newer queued commits when its own %s navigation is observed by multiple subscribers',
    async (mode) => {
      const { external, setExternal, navigate, location, commit } = setup();
      if (mode === 'transition') {
        navigate.mockImplementation((url, options) => {
          void startTransition(() =>
            setExternal({ ...parseExternalLocation(url), state: options.state })
          );
        });
      }
      const secondListener = vi.fn();
      disposers.push(location.subscribe(secondListener));

      commit('/item/first');
      commit('/item/second');
      await vi.runAllTimersAsync();

      expect(navigate.mock.calls.map(([url]) => url)).toEqual([
        '/item/first',
        '/item/second',
      ]);
      expect(external().pathname).toBe('/item/second');
      expect(secondListener).toHaveBeenCalledTimes(2);
    }
  );

  it('expires coalesced echoes so Back to an older commit cancels a pending write', async () => {
    const { external, setExternal, navigate, commit } = setup();
    navigate.mockImplementation(() => {});
    commit('/item/first');
    commit('/item/second');
    await vi.runAllTimersAsync();
    setExternal(parseExternalLocation('/item/second'));
    navigate.mockClear();

    commit('/item/third');
    setExternal(parseExternalLocation('/item/first'));
    await vi.runAllTimersAsync();

    expect(navigate).not.toHaveBeenCalled();
    expect(external().pathname).toBe('/item/first');
  });

  it('lets Back supersede a queued commit after an earlier commit has been observed', async () => {
    const { external, setExternal, navigate, commit } = setup();
    navigate.mockImplementationOnce((url, options) => {
      setExternal({ ...parseExternalLocation(url), state: options.state });
      setExternal(parseExternalLocation('/item/back'));
    });

    commit('/item/first');
    commit('/item/second');
    await vi.runAllTimersAsync();

    expect(navigate).toHaveBeenCalledTimes(1);
    expect(external().pathname).toBe('/item/back');
  });

  it('keeps location-sync acknowledgements consistent when Back cancels a queued commit', async () => {
    const { external, setExternal, navigate, location } = setup();
    const routes = createRoutesManifest({
      definitions: [{ id: 'item', path: 'item/:id' }],
    });
    const sync = createLocationSync({ routes, location });
    const acknowledge = vi.fn((next: SplitRouterExternalLocationValue) =>
      sync.acknowledge(next)
    );
    disposers.push(location.subscribe(acknowledge));
    const commit = (id: string) =>
      sync.commit([{ ...decodeRoute(routes, ['item', id])!, key: id }], {
        history: 'push',
        preserveHash: false,
      });

    commit('first');
    await vi.runAllTimersAsync();
    const first = external();
    commit('second');
    commit('third');
    await vi.runAllTimersAsync();
    expect(navigate.mock.calls.map(([url]) => url)).toEqual([
      '/item/first',
      '/item/second',
      '/item/third',
    ]);
    expect(acknowledge.mock.results.map(({ value }) => value)).toEqual([
      true,
      true,
      true,
    ]);

    navigate.mockClear();
    commit('fourth');
    setExternal(first);
    await vi.runAllTimersAsync();
    expect(acknowledge).toHaveLastReturnedWith(false);
    expect(navigate).not.toHaveBeenCalled();
    expect(external()).toEqual(first);

    // A cancelled request must not prevent a later attempt at the same destination.
    commit('fourth');
    await vi.runAllTimersAsync();
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(external().pathname).toBe('/item/fourth');
    expect(acknowledge).toHaveLastReturnedWith(true);
  });
});
