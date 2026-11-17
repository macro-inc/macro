import { createRoot, createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';

const [flag, setFlag] = createSignal<{
  enabled: boolean;
  payload: { maxParked?: number; hiddenViews?: string } | undefined;
  loading: boolean;
}>({ enabled: true, payload: { maxParked: 3 }, loading: false });

vi.mock('@app/lib/analytics/posthog', () => ({ useFeatureFlag: () => flag }));
vi.mock('@core/mobile/isMobile', () => ({ isMobile: () => true }));
// The test routes stand in for the app's: `block` shows an entity, the
// others are dock views named after their route.
vi.mock('../split-router/legacy-route', () => ({
  splitContentFromLocation: (location: SplitLocation) => {
    const [, root] = location.route.matches;
    return root?.id === 'block'
      ? { type: 'channel', id: String(root.params.id) }
      : { type: 'component', id: root?.id };
  },
}));

import { createMemoryHistory } from '@app/lib/split-router/history/memory';
import { createMemoryPaneStore } from '@app/lib/split-router/panes/memory-store';
import { createSplitRouter } from '@app/lib/split-router/router/create-router';
import type {
  Entry,
  PaneId,
  SplitLocation,
} from '@app/lib/split-router/routes/types';
import {
  appLocation,
  appRoutes,
  createTestPolicy,
} from '@app/lib/split-router/tests/fixtures';
import { fireAndForget } from '@core/util/fireAndForget';
import type {
  ReplaceAllSplitsOptions,
  SplitContent,
  SplitManager,
} from '../layoutManager';
import { createMobileDockParking } from '../mobile/createMobileDockParking';

const pane = (id: number) => `pane-${id}` as PaneId;
const settle = () => new Promise((done) => setTimeout(done));

function setup(url: string) {
  const [sessionKey, setSessionKey] = createSignal<string | undefined>('user');
  const kept: string[] = [];
  const activated: string[] = [];
  let created = 0;

  return createRoot((dispose) => {
    const router = createSplitRouter({
      routes: appRoutes,
      history: createMemoryHistory(url),
      paneStore: createMemoryPaneStore<Entry>(),
      policy: createTestPolicy().policy,
      createPaneId: () => pane(++created),
    });
    // What the parking needs from the layout manager, over the real router.
    const manager = {
      replaceAllSplits: (
        content: SplitContent,
        options: ReplaceAllSplitsOptions = {}
      ) => {
        fireAndForget(
          Promise.resolve(
            router.navigate(
              { location: appLocation(content.id) },
              { park: options.park as readonly string[] as readonly PaneId[] }
            )
          ),
          'test'
        );
      },
      viewState: { keep: (owner: string) => kept.push(owner) },
      activateSplit: (id: string) => activated.push(id),
    } as unknown as SplitManager;
    const parking = createMobileDockParking({ router, manager, sessionKey });
    const show = async (id: string) => {
      parking.show({ type: 'component', id }, { resume: true });
      await settle();
    };
    const parked = () =>
      router.retainedPanes().filter((id) => !router.panes().includes(id));
    const viewOf = (id: PaneId) =>
      router.entry(id)?.location.route.matches[1]?.id;

    return {
      router,
      show,
      parked,
      viewOf,
      kept,
      activated,
      setSessionKey,
      dispose: () => {
        router.dispose();
        dispose();
      },
    };
  });
}

let cleanup: (() => void) | undefined;
const track = <T extends { dispose: () => void }>(context: T) => {
  cleanup = context.dispose;
  return context;
};

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  setFlag({ enabled: true, payload: { maxParked: 3 }, loading: false });
});

describe('mobile dock parking', () => {
  it('parks the view it leaves and shows it again as it was', async () => {
    const { router, show, parked, activated } = track(setup('/home'));
    const home = router.entry(pane(1));

    await show('mail');
    expect(router.panes()).toEqual([pane(2)]);
    expect(parked()).toEqual([pane(1)]);

    await show('home');
    expect(router.panes()).toEqual([pane(1)]);
    expect(router.entry(pane(1))).toBe(home);
    expect(parked()).toEqual([pane(2)]);
    expect(activated).toEqual([pane(1)]);
  });

  it('closes panes opened above the view and parks only the view', async () => {
    const { router, show, parked, viewOf } = track(setup('/home/~/channel/c1'));

    await show('mail');
    expect(router.panes().map(viewOf)).toEqual(['mail']);
    expect(parked().map(viewOf)).toEqual(['home']);
    expect(router.retainedPanes().map(viewOf)).not.toContain('block');
  });

  it('parks nothing from a stack deeper than the two panes it mounts', async () => {
    const { show, parked } = track(setup('/home/~/channel/c1/~/channel/c2'));

    await show('mail');
    expect(parked()).toEqual([]);
  });

  it('discards the least recently shown view past the limit, keeping its view state', async () => {
    setFlag({ enabled: true, payload: { maxParked: 1 }, loading: false });
    const { show, parked, viewOf, kept } = track(setup('/home'));

    await show('mail');
    await show('drive');
    expect(parked().map(viewOf)).toEqual(['mail']);
    expect(kept).toEqual([pane(1)]);

    await show('mail');
    expect(parked().map(viewOf)).toEqual(['drive']);
  });

  it('drops every parked view when the account changes or parking turns off', async () => {
    const context = track(setup('/home'));
    await context.show('mail');
    await context.show('drive');
    expect(context.parked()).toHaveLength(2);

    context.setSessionKey('other-user');
    expect(context.parked()).toEqual([]);

    await context.show('mail');
    expect(context.parked()).toHaveLength(1);
    setFlag({ enabled: false, payload: undefined, loading: false });
    expect(context.parked()).toEqual([]);
  });

  it('replaces a parked copy when a link opens the view again', async () => {
    const { router, show, parked, viewOf } = track(setup('/home'));
    await show('mail');

    await router.navigate('/home');
    expect(router.panes().map(viewOf)).toEqual(['home']);
    expect(parked()).toEqual([]);
  });

  it('switches as before when parking is off', async () => {
    setFlag({ enabled: false, payload: undefined, loading: false });
    const { router, show, parked } = track(setup('/home'));

    await show('mail');
    expect(router.panes()).toEqual([pane(1)]);
    expect(parked()).toEqual([]);
  });
});
