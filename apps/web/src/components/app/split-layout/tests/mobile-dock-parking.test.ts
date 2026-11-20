import { createRoot, createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';

const [flag, setFlag] = createSignal<{
  enabled: boolean;
  payload: { maxParked?: number } | undefined;
  loading: boolean;
}>({ enabled: true, payload: { maxParked: 3 }, loading: false });

vi.mock('@app/lib/analytics/posthog', () => ({ useFeatureFlag: () => flag }));
// The attributes each navigation's perf span starts with.
const navigationAttributes = vi.hoisted((): Record<string, unknown>[] => []);
vi.mock(import('@app/observability/flow'), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    beginInteraction: (...args: Parameters<typeof actual.beginInteraction>) => {
      if (args[0] === 'navigation')
        navigationAttributes.push({ ...args[1]?.attributes });
      return actual.beginInteraction(...args);
    },
  };
});
vi.mock('@core/mobile/isMobile', () => ({ isMobile: () => true }));
// The test routes stand in for the app's: `block` shows an entity, the
// others are dock views named after their route. `drive` shows the content
// `mail` does, as Projects shows the Tasks content, and resumes as its own view.
const routeOf = (content: SplitContent): string => {
  const view = (content.entryMetadata as { view?: string } | undefined)?.view;
  return view ?? content.id;
};
vi.mock('../split-router/legacy-route', () => ({
  resolveContentLocation: (_routes: unknown, content: SplitContent) => ({
    route: {
      matches: [
        { id: 'app', params: {} },
        { id: routeOf(content), params: {} },
      ],
    },
  }),
  splitContentFromLocation: (location: SplitLocation) => {
    const [, root] = location.route.matches;
    if (root?.id === 'block')
      return { type: 'channel', id: String(root.params.id) };
    return { type: 'component', id: root?.id === 'drive' ? 'mail' : root?.id };
  },
}));
vi.mock('../view-restoration-key', () => ({
  viewRestorationKey: (id: string, location?: SplitLocation) =>
    location?.route.matches[1]?.id ?? id,
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

function setup(url: string, returnsTo: (view: string) => boolean = () => true) {
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
              { location: appLocation(routeOf(content)) },
              {
                park: options.park as readonly string[] as readonly PaneId[],
                attributes: options.attributes,
              }
            )
          ),
          'test'
        );
      },
      viewState: { keep: (owner: string) => kept.push(owner) },
      activateSplit: (id: string) => activated.push(id),
      unSpotlightSplit: () => {},
    } as unknown as SplitManager;
    const parking = createMobileDockParking({ router, manager, sessionKey });
    const show = async (id: string, view?: string) => {
      parking.show(
        { type: 'component', id, entryMetadata: view ? { view } : undefined },
        { resume: true },
        returnsTo
      );
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
  navigationAttributes.length = 0;
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

  it('records on the navigation span whether the view came back from parked', async () => {
    const { show } = track(setup('/home'));
    navigationAttributes.length = 0;

    await show('mail');
    await show('home');
    expect(navigationAttributes).toEqual([
      expect.objectContaining({
        'navigation.restored_from_parked': false,
        'mobile_dock.evicted': 0,
        'mobile_dock.parked_count': 1,
      }),
      expect.objectContaining({
        'navigation.restored_from_parked': true,
        'mobile_dock.evicted': 0,
        'mobile_dock.parked_count': 1,
      }),
    ]);
  });

  it('closes panes opened above the view and parks only the view', async () => {
    const { router, show, parked, viewOf } = track(setup('/home/~/channel/c1'));

    await show('mail');
    expect(router.panes().map(viewOf)).toEqual(['mail']);
    // A pane of its own, not the channel's with the channel in its history.
    expect(router.panes()).toEqual([pane(3)]);
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

  it('keeps dock views that share content apart', async () => {
    const { router, show, parked, viewOf } = track(setup('/home'));
    await show('mail');
    await show('mail', 'drive');
    expect(router.panes().map(viewOf)).toEqual(['drive']);
    expect(parked().map(viewOf)).toEqual(['home', 'mail']);

    await show('mail');
    expect(router.panes().map(viewOf)).toEqual(['mail']);
    expect(parked().map(viewOf)).toEqual(['home', 'drive']);
  });

  it('does not park a view the dock cannot show again', async () => {
    const { show, parked } = track(setup('/home', (view) => view !== 'home'));

    await show('mail');
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
