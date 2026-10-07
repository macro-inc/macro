import { createEffect, createRoot, untrack } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory } from '../history/memory';
import { createSolidRouterHistory } from '../history/solid-router';
import type { HistoryAdapter } from '../history/types';
import { createMemoryPaneStore } from '../panes/memory-store';
import { createSplitRouter } from '../router/create-router';
import { PANE_LEVEL } from '../router/leave-guards';
import type { SplitCloseAction, SplitRouterOptions } from '../router/types';
import { defineRoute } from '../routes/define';
import type {
  Entry,
  PaneId,
  SplitRouteDefinition,
  SplitRoutes,
} from '../routes/types';
import { isPromise } from '../utils';
import { createFakeSolidRouter } from './fake-solid-router';
import {
  appLocation,
  appRoute,
  appRoutes,
  createTestPolicy,
  homeLocation,
  loginRoute,
} from './fixtures';

function setup(
  url: string,
  overrides: Partial<SplitRouterOptions> = {},
  testPolicy = createTestPolicy()
) {
  const history = createMemoryHistory(url);
  const paneStore = createMemoryPaneStore<Entry>();
  const { policy, activated, placements } = testPolicy;
  let created = 0;
  const { router, dispose } = createRoot((dispose) => ({
    router: createSplitRouter({
      routes: appRoutes,
      history,
      paneStore,
      policy,
      createPaneId: () => `pane-${++created}` as PaneId,
      ...overrides,
    }),
    dispose,
  }));
  return {
    router,
    history,
    paneStore,
    activated,
    placements,
    pane: (index: number) => router.panes()[index]!,
    dispose: () => {
      router.dispose();
      dispose();
    },
  };
}

/** A router over the Solid Router fake mounted at `/app`. */
function setupSolid(url: string, ahead: readonly string[] = []) {
  const solid = createFakeSolidRouter(url, ahead);
  return createRoot((dispose) => {
    const router = createSplitRouter({
      routes: appRoutes,
      history: createSolidRouterHistory({
        location: solid.location,
        navigate: solid.navigate,
        base: '/app',
        beforeLeave: solid.beforeLeave,
        landedPath: solid.landed,
      }),
      paneStore: createMemoryPaneStore(),
      policy: createTestPolicy().policy,
    });
    return {
      router,
      solid,
      dispose: () => {
        router.dispose();
        dispose();
      },
    };
  });
}

/** Memory history whose reverts land only when the test says so. */
function slowRevertHistory(url: string) {
  const history = createMemoryHistory(url);
  const landings: (() => void)[] = [];
  const adapter: HistoryAdapter = {
    ...history,
    subscribe: (listener) =>
      history.subscribe((change) =>
        listener({
          ...change,
          revert: () =>
            new Promise<void>((resolve) => {
              landings.push(() => {
                void change.revert();
                resolve();
              });
            }),
        })
      ),
  };

  const landAll = async () => {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      landings.shift()?.();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  };

  return { history, adapter, landAll };
}

/** The level of a pane's first route, below the app route. */
const PANE_ROUTE_LEVEL = 1;
/** The pane route ids below the app route. */
const routeIds = (entry: Entry | undefined) =>
  entry?.location.route.matches
    .map((match) => match.id)
    .filter((id) => id !== 'app');
const location = appLocation;
const withPaneRoutes = (...children: SplitRouteDefinition[]): SplitRoutes => ({
  ...appRoutes,
  definitions: [
    loginRoute,
    { ...appRoute, children: [...appRoute.children, ...children] },
  ],
});
const never = () => new Promise<boolean>(() => {});

let cleanup: (() => void) | undefined;
const track = <T extends { dispose: () => void }>(context: T) => {
  cleanup = context.dispose;
  return context;
};

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('split router', () => {
  it('starts ready with one pane per URL segment and records pane state in place', () => {
    const { router, history } = track(setup('/mail/t1/~/drive'));
    expect(router.ready()).toBe(true);
    expect(router.panes()).toEqual(['pane-1', 'pane-2']);
    expect(history.entries()).toHaveLength(1);
    expect(history.read().state?.panes.map((pane) => pane.pane)).toEqual([
      'pane-1',
      'pane-2',
    ]);
  });

  it('navigates one pane without touching the others', () => {
    const { router, history, pane } = track(setup('/home/~/drive'));
    const drive = router.entry(pane(1));

    const result = router.navigatePane(pane(0), '/mail/t1');
    expect(result).toEqual({ status: 'committed', pane: pane(0) });
    expect(router.entry(pane(1))).toBe(drive);
    expect(router.arrival(pane(1))).toBe('fresh');
    expect(history.entries().map((entry) => entry.path)).toEqual([
      '/home/~/drive',
      '/mail/t1/~/drive',
    ]);
  });

  it('replaces a URL whose panes sit under different top-level routes with the default route', () => {
    const { router, history } = track(setup('/login/~/home'));
    expect(router.panes().map((id) => routeIds(router.entry(id)))).toEqual([
      ['home'],
    ]);
    expect(history.entries().map((entry) => entry.path)).toEqual(['/home']);
  });

  it('turns a pane navigation outside the shared top-level route into a whole-window one, and Back rebuilds the panes', () => {
    const { router, history, pane } = track(setup('/home/~/mail'));
    router.navigatePane(pane(1), '/login');
    expect(
      router.panes().map((id) => router.entry(id)?.location.route.matches)
    ).toEqual([[{ id: 'login', params: {} }]]);
    expect(history.entries().map((entry) => entry.path)).toEqual([
      '/home/~/mail',
      '/login',
    ]);

    history.back();
    expect(router.panes().map((id) => routeIds(router.entry(id)))).toEqual([
      ['home'],
      ['mail'],
    ]);
  });

  it('skips entries under another top-level route on pane Back while other panes share the app route', () => {
    const { router, pane } = track(setup('/home'));
    router.navigatePane(pane(0), '/login');
    router.navigatePane(pane(0), '/mail');
    router.open('/drive', { newPane: true, source: pane(0) });
    expect(router.panes()).toHaveLength(2);

    expect(router.canGo(pane(0), -1)).toBe(true);
    router.navigatePane(pane(0), -1);
    expect(routeIds(router.entry(pane(0)))).toEqual(['home']);
    expect(router.canGo(pane(0), -1)).toBe(false);
  });

  it('pane back replaces the browser entry and records how the pane arrived', () => {
    const { router, history, pane } = track(setup('/home'));
    router.navigatePane(pane(0), '/mail');
    router.navigatePane(pane(0), -1);
    expect(routeIds(router.entry(pane(0)))).toEqual(['home']);
    expect(router.arrival(pane(0))).toBe('back');
    expect(router.canGo(pane(0), 1)).toBe(true);
    expect(history.entries().map((entry) => entry.path)).toEqual([
      '/home',
      '/home',
    ]);
  });

  it('browser back brings a pane back through its own history', () => {
    const { router, history, paneStore, pane } = track(setup('/home/~/drive'));
    router.navigatePane(pane(0), '/mail');
    const drive = router.entry(pane(1));
    history.back();
    expect(routeIds(router.entry(pane(0)))).toEqual(['home']);
    expect(router.arrival(pane(0))).toBe('back');
    expect(paneStore.read(pane(0))).toMatchObject({ index: 0 });
    expect(paneStore.read(pane(0))?.entries).toHaveLength(2);
    expect(router.entry(pane(1))).toBe(drive);
  });

  it('a leave guard can refuse browser back, and the URL is put back', () => {
    const { router, history, pane } = track(setup('/home'));
    router.navigatePane(pane(0), '/mail');
    router.registerGuard(pane(0), PANE_ROUTE_LEVEL, () => false);
    history.back();
    expect(routeIds(router.entry(pane(0)))).toEqual(['mail']);
    expect(history.index()).toBe(1);
    expect(history.read().path).toBe('/mail');
  });

  it('ignores the report of its own revert landing', async () => {
    vi.useFakeTimers();
    const { router, solid } = track(setupSolid('/app/home'));
    vi.runAllTimers();
    const pane = router.panes()[0]!;
    router.navigatePane(pane, '/mail');
    vi.runAllTimers();
    const mail = router.entry(pane);
    router.registerGuard(pane, PANE_ROUTE_LEVEL, () => false);

    solid.traverse(-1);
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    vi.runAllTimers();
    expect(router.entry(pane)).toBe(mail);
    expect(solid.calls.map(([to]) => to)).toEqual(['/home', '/mail', 1]);
    expect(solid.location.pathname).toBe('/app/mail');
  });

  it('keeps an async-guarded navigation pending until the guard settles', async () => {
    const { router, pane } = track(setup('/home'));
    let allow: (value: boolean) => void = () => {};
    router.registerGuard(
      pane(0),
      PANE_ROUTE_LEVEL,
      () =>
        new Promise<boolean>((resolve) => {
          allow = resolve;
        })
    );
    const result = router.navigatePane(pane(0), '/mail');
    expect(isPromise(result)).toBe(true);
    expect(routeIds(router.pending(pane(0))?.to)).toEqual(['mail']);
    expect(routeIds(router.entry(pane(0)))).toEqual(['home']);
    allow(true);
    await expect(result).resolves.toMatchObject({ status: 'committed' });
    expect(router.pending(pane(0))).toBeUndefined();
    expect(routeIds(router.entry(pane(0)))).toEqual(['mail']);
  });

  it('a newer navigation in the same pane supersedes a pending one', async () => {
    const { router, pane } = track(
      setup('/home', {
        middleware: [
          async ({ path }) => {
            if (path === '/mail')
              await new Promise((done) => setTimeout(done, 10));
          },
        ],
      })
    );
    expect(router.ready()).toBe(false);
    await router.settled();
    expect(router.ready()).toBe(true);
    const first = router.navigatePane(pane(0), '/mail');
    const second = router.navigatePane(pane(0), '/drive');
    await expect(first).resolves.toEqual({ status: 'cancelled' });
    await expect(second).resolves.toMatchObject({ status: 'committed' });
    expect(routeIds(router.entry(pane(0)))).toEqual(['drive']);
  });

  it('a superseded navigation settles even when its guard never does', async () => {
    const { router, pane } = track(setup('/home'));
    const unregister = router.registerGuard(pane(0), PANE_ROUTE_LEVEL, never);
    const first = router.navigatePane(pane(0), '/mail');
    unregister();
    const second = router.navigatePane(pane(0), '/drive');
    await expect(first).resolves.toEqual({ status: 'cancelled' });
    expect(second).toMatchObject({ status: 'committed' });
  });

  it('ignores a superseded navigation whose guard answers late', async () => {
    const { router, pane } = track(setup('/home'));
    const answers: ((allowed: boolean) => void)[] = [];
    router.registerGuard(
      pane(0),
      PANE_ROUTE_LEVEL,
      () => new Promise<boolean>((resolve) => answers.push(resolve))
    );
    const first = router.navigatePane(pane(0), '/mail');
    const second = router.navigatePane(pane(0), '/drive');
    answers[0]!(true);
    answers[1]!(false);
    await expect(first).resolves.toEqual({ status: 'cancelled' });
    await expect(second).resolves.toEqual({ status: 'cancelled' });
    expect(routeIds(router.entry(pane(0)))).toEqual(['home']);
  });

  it('browser back cancels a pane navigation still in flight', async () => {
    const { router, history, pane } = track(setup('/home'));
    router.navigatePane(pane(0), '/mail');
    let allow: (allowed: boolean) => void = () => {};
    router.registerGuard(pane(0), PANE_ROUTE_LEVEL, ({ cause }) =>
      cause === 'external'
        ? true
        : new Promise<boolean>((resolve) => {
            allow = resolve;
          })
    );
    const drive = router.navigatePane(pane(0), '/drive');
    history.back();
    allow(true);
    await expect(drive).resolves.toEqual({ status: 'cancelled' });
    expect(routeIds(router.entry(pane(0)))).toEqual(['home']);
  });

  it('mounts the URL even when middleware cancels the initial load', () => {
    const { router, pane } = track(
      setup('/mail', { middleware: [({ cancel }) => cancel()] })
    );
    expect(router.ready()).toBe(true);
    expect(routeIds(router.entry(pane(0)))).toEqual(['mail']);
  });

  it('settles commands waiting on the initial load when disposed', async () => {
    const { router, dispose } = setup('/home', {
      middleware: [() => new Promise<void>(() => {})],
    });
    const opened = router.open('/mail', { newPane: true });
    dispose();
    await expect(opened).resolves.toEqual({ status: 'cancelled' });
  });

  it('waits for an async initial load before opening a pane', async () => {
    const { router } = track(
      setup('/home/~/drive', { middleware: [async () => {}] })
    );
    expect(router.ready()).toBe(false);
    const opened = router.open('/mail', { newPane: true });
    await expect(opened).resolves.toEqual({
      status: 'committed',
      pane: 'pane-3',
    });
    expect(router.ready()).toBe(true);
    expect(router.panes()).toEqual(['pane-1', 'pane-2', 'pane-3']);
  });

  it('drops commands still waiting on a revert once disposed', async () => {
    vi.useFakeTimers();
    const { router, solid } = track(setupSolid('/app/home'));
    vi.runAllTimers();
    const pane = router.panes()[0]!;
    router.navigatePane(pane, '/mail');
    vi.runAllTimers();
    router.registerGuard(pane, PANE_ROUTE_LEVEL, never);
    solid.traverse(-1);

    const rewrite = router.rewriteCurrent(pane, '/drive');
    router.move(pane, 0);
    router.dispose();
    await expect(rewrite).resolves.toEqual({ status: 'cancelled' });
    vi.runAllTimers();
    expect(solid.calls.map(([to]) => to)).toEqual(['/home', '/mail', 1]);
  });

  it('a pane command cancels a pending browser back and reverts it first', () => {
    const { router, history, pane } = track(setup('/home/~/drive'));
    router.navigatePane(pane(0), '/mail');
    let guardSignal: AbortSignal | undefined;
    router.registerGuard(pane(0), PANE_ROUTE_LEVEL, ({ signal }) => {
      guardSignal = signal;
      return never();
    });
    history.back();
    expect(routeIds(router.pending(pane(0))?.to)).toEqual(['home']);

    expect(router.navigatePane(pane(1), '/drive/folder/f1')).toMatchObject({
      status: 'committed',
    });
    expect(guardSignal?.aborted).toBe(true);
    expect(router.pending(pane(0))).toBeUndefined();
    expect(routeIds(router.entry(pane(0)))).toEqual(['mail']);
    expect(history.entries().map((entry) => entry.path)).toEqual([
      '/home/~/drive',
      '/mail/~/drive',
      '/mail/~/drive/folder/f1',
    ]);
    expect(history.index()).toBe(2);
  });

  it('writes after the reverted back has landed', async () => {
    vi.useFakeTimers();
    const { router, solid } = track(setupSolid('/app/home'));
    vi.runAllTimers();
    const pane = router.panes()[0]!;
    router.navigatePane(pane, '/mail');
    vi.runAllTimers();
    router.registerGuard(pane, PANE_ROUTE_LEVEL, ({ cause }) =>
      cause === 'external' ? never() : true
    );
    solid.traverse(-1);
    expect(routeIds(router.pending(pane)?.to)).toEqual(['home']);

    const result = router.navigatePane(pane, '/drive');
    expect(isPromise(result)).toBe(true);
    await expect(result).resolves.toMatchObject({ status: 'committed' });
    vi.runAllTimers();
    expect(solid.calls.map(([to]) => to)).toEqual([
      '/home',
      '/mail',
      1,
      '/drive',
    ]);
    expect(solid.entries().map((entry) => entry.path)).toEqual([
      '/app/home',
      '/app/mail',
      '/app/drive',
    ]);
  });

  it('reports a pending URL navigation only for the panes it changes', async () => {
    let slow = false;
    const { router, history, pane } = track(
      setup('/home/~/drive', {
        middleware: [
          ({ path }) =>
            slow && path === '/home'
              ? new Promise<void>((done) => setTimeout(done, 5))
              : undefined,
        ],
      })
    );
    router.navigatePane(pane(0), '/mail');
    slow = true;
    history.back();
    expect(routeIds(router.pending(pane(0))?.to)).toEqual(['home']);
    expect(router.pending(pane(1))).toBeUndefined();
    await router.settled();
    expect(routeIds(router.entry(pane(0)))).toEqual(['home']);
  });

  it('opening something another pane shows activates that pane instead', () => {
    const { router, activated, pane } = track(setup('/drive/md/d1/~/home'));
    const result = router.navigatePane(pane(1), '/md/d1');
    expect(result).toEqual({ status: 'activated', owner: pane(0) });
    expect(activated).toEqual([pane(0)]);
    expect(routeIds(router.entry(pane(1)))).toEqual(['home']);
    expect(
      router.navigatePane(pane(1), '/md/d1', { allowDuplicate: true })
    ).toMatchObject({ status: 'committed' });
  });

  it('tells the policy who shows a new pane’s destination and whether a duplicate is allowed', () => {
    const testPolicy = createTestPolicy();
    const { router, pane } = track(setup('/md/d1/~/home', {}, testPolicy));
    const target = { newPane: true as const, source: pane(1) };

    router.open('/md/d1', target, { allowDuplicate: true });

    expect(testPolicy.placements).toMatchObject([
      { holder: pane(0), allowDuplicate: true },
    ]);
  });

  it('opens a new pane beside the one showing the destination when the policy places it there', () => {
    const { router, activated, pane } = track(setup('/md/d1/~/home'));

    const result = router.open('/md/d1', { newPane: true, source: pane(1) });

    expect(result).toMatchObject({ status: 'committed' });
    expect(router.panes()).toHaveLength(3);
    expect(activated).toEqual([]);
  });

  it('brings up a pane that started showing a new pane’s destination after it was placed', async () => {
    let release: () => void = () => {};
    let held = false;
    const holdFirstVisit = ({ path }: { path: string }) => {
      if (path !== '/md/d1' || held) return;

      held = true;

      return new Promise<void>((resolve) => {
        release = resolve;
      });
    };
    const { router, pane } = track(
      setup('/home/~/drive', { middleware: [holdFirstVisit] })
    );

    const opened = router.open('/md/d1', { newPane: true, source: pane(1) });
    router.navigatePane(pane(0), '/md/d1');
    release();

    await expect(opened).resolves.toEqual({
      status: 'activated',
      owner: pane(0),
    });
    expect(router.panes()).toHaveLength(2);
  });

  it('skips entries another pane shows on Back and Forward, unless duplicates are allowed', () => {
    const { router, pane } = track(setup('/home/~/home'));
    router.navigatePane(pane(0), '/md/d1');
    router.navigatePane(pane(0), '/drive');
    router.navigatePane(pane(1), '/md/d1');

    router.navigatePane(pane(0), -1);
    expect(routeIds(router.entry(pane(0)))).toEqual(['home']);
    expect(router.canGo(pane(0), 1)).toBe(true);

    router.navigatePane(pane(0), 1, { allowDuplicate: true });
    expect(routeIds(router.entry(pane(0)))).toEqual(['block']);
  });

  it('keeps duplicates loaded from a URL', () => {
    const { router } = track(setup('/md/d1/~/md/d1'));
    expect(router.panes()).toHaveLength(2);
  });

  it('changing search in a duplicate keeps it in place', () => {
    const { router, activated, pane } = track(
      setup('/drive/md/d1/~/drive/md/d1')
    );
    expect(
      router.updateSearch(pane(1), 'drive', { sort: ['name'] })
    ).toMatchObject({ status: 'committed', pane: pane(1) });
    expect(activated).toEqual([]);
  });

  it('browser back brings back a duplicate', () => {
    const { router, history, activated, pane } = track(setup('/home/~/md/d1'));
    router.navigatePane(pane(0), '/md/d1', { allowDuplicate: true });
    router.navigatePane(pane(0), '/drive');
    history.back();
    expect(routeIds(router.entry(pane(0)))).toEqual(['block']);
    expect(activated).toEqual([]);
  });

  it('opens and closes panes where the policy places them', () => {
    const { router, history } = track(setup('/home/~/drive'));
    expect(
      router.open('/mail', {
        newPane: true,
        source: 'pane-1' as PaneId,
      })
    ).toEqual({ status: 'committed', pane: 'pane-3' });
    expect(router.panes()).toEqual(['pane-1', 'pane-3', 'pane-2']);
    expect(history.read().path).toBe('/home/~/mail/~/drive');

    expect(router.open('/home', { pane: 'pane-3' as PaneId })).toEqual({
      status: 'committed',
      pane: 'pane-3',
    });
    expect(router.close('pane-3' as PaneId)).toBe(true);
    expect(router.close('pane-2' as PaneId)).toBe(true);
    expect(router.panes()).toEqual(['pane-1']);
    expect(history.read().path).toBe('/home');

    expect(router.close('pane-1' as PaneId)).toBe(false);
    router.navigatePane('pane-1' as PaneId, '/mail');
    expect(router.close('pane-1' as PaneId)).toBe(true);
    expect(router.panes()).toEqual(['pane-1']);
    expect(history.read().path).toBe('/home');
  });

  it('opens several panes at once without one cancelling another', async () => {
    const { router } = track(
      setup('/home', {
        middleware: [
          ({ path }) => (path === '/home' ? undefined : Promise.resolve()),
        ],
      })
    );
    const source = 'pane-1' as PaneId;
    const first = router.open('/mail', { newPane: true, source });
    const second = router.open('/drive', { newPane: true, source });
    await expect(first).resolves.toEqual({
      status: 'committed',
      pane: 'pane-2',
    });
    await expect(second).resolves.toEqual({
      status: 'committed',
      pane: 'pane-3',
    });
    expect(router.panes()).toEqual(['pane-1', 'pane-2', 'pane-3']);
  });

  it('lets the policy open in an existing pane when enough are open', () => {
    const testPolicy = createTestPolicy({ maxPanes: 2 });
    const { router } = track(setup('/home/~/drive', {}, testPolicy));
    const intent = { replaceWhenFull: true };
    expect(
      router.open('/mail', {
        newPane: true,
        source: 'pane-2' as PaneId,
        intent,
      })
    ).toEqual({ status: 'committed', pane: 'pane-2' });
    expect(router.panes()).toEqual(['pane-1', 'pane-2']);
    expect(routeIds(router.entry('pane-2' as PaneId))).toEqual(['mail']);
    expect(testPolicy.placements).toEqual([
      {
        destination: location('mail'),
        source: 'pane-2',
        intent,
        allowDuplicate: false,
        opening: 0,
        panes: ['pane-1', 'pane-2'],
      },
    ]);
  });

  it('keeps a pane the policy pins, without asking its guards', () => {
    const { router } = track(
      setup(
        '/home/~/mail',
        {},
        createTestPolicy({ pinned: ['pane-1' as PaneId] })
      )
    );
    const guard = vi.fn(() => true);
    router.registerGuard('pane-1' as PaneId, PANE_ROUTE_LEVEL, guard);
    expect(router.close('pane-1' as PaneId)).toBe(false);
    expect(router.panes()).toEqual(['pane-1', 'pane-2']);
    expect(guard).not.toHaveBeenCalled();
  });

  it('navigates from the base, keeping the pane that already shows the destination', () => {
    const { router, history } = track(setup('/home/~/mail/~/drive'));
    const [home, mail, drive] = router.panes();
    const mailEntry = router.entry(mail!);
    let allowDrive = false;
    router.registerGuard(drive!, PANE_LEVEL, () => allowDrive);

    expect(router.navigate('/mail')).toMatchObject({ status: 'cancelled' });
    expect(router.panes()).toEqual([home, mail, drive]);

    allowDrive = true;
    expect(router.navigate('/mail')).toMatchObject({ status: 'committed' });
    expect(router.panes()).toEqual([mail]);
    expect(router.entry(mail!)).toBe(mailEntry);
    expect(history.entries().map((entry) => entry.path)).toEqual([
      '/home/~/mail/~/drive',
      '/mail',
    ]);
  });

  it('keeps panes that already show their entry when a base navigation reorders them', () => {
    const { router, history } = track(setup('/home/~/mail'));
    const [home] = router.panes();

    router.navigate('/drive/~/home');
    expect(router.panes().map((id) => routeIds(router.entry(id)))).toEqual([
      ['drive'],
      ['home'],
    ]);
    expect(router.panes()[1]).toBe(home);
    expect(history.read().path).toBe('/drive/~/home');

    router.navigate({ location: location('mail') });
    expect(router.panes().map((id) => routeIds(router.entry(id)))).toEqual([
      ['mail'],
    ]);
  });

  it('closing the last pane can go back to an earlier entry', () => {
    const closeLast: SplitCloseAction = {
      type: 'back-to',
      to: (entry) => routeIds(entry)?.[0] === 'mail',
      otherwise: { type: 'navigate', destination: homeLocation, replace: true },
    };
    const { router, pane } = track(
      setup('/mail', {}, createTestPolicy({ closeLast }))
    );
    router.navigatePane(pane(0), '/drive');
    expect(router.close(pane(0))).toBe(true);
    expect(routeIds(router.entry(pane(0)))).toEqual(['mail']);
    expect(router.canGo(pane(0), 1)).toBe(true);
  });

  it('closing the last pane can replace it without a back entry', () => {
    const closeLast: SplitCloseAction = {
      type: 'back-to',
      to: (entry) => routeIds(entry)?.[0] === 'mail',
      otherwise: { type: 'navigate', destination: homeLocation, replace: true },
    };
    const { router, history, pane } = track(
      setup('/drive', {}, createTestPolicy({ closeLast }))
    );
    expect(router.close(pane(0))).toBe(true);
    expect(routeIds(router.entry(pane(0)))).toEqual(['home']);
    expect(router.canGo(pane(0), -1)).toBe(false);
    expect(history.entries()).toHaveLength(1);
  });

  it('keeps the hash of the URL it follows through a redirect', () => {
    const { history } = track(
      setup('/home#focus', {
        middleware: [
          ({ path, redirect }) =>
            path === '/home' ? redirect('/mail') : undefined,
        ],
      })
    );
    expect(history.read()).toMatchObject({ path: '/mail', hash: '#focus' });
  });

  it('writes an outside navigation with its own hash and global search', async () => {
    const { history } = track(setup('/home?referral_code=old#top'));
    await history.navigate('/mail/t2?referral_code=new#frag');
    expect(history.read()).toMatchObject({
      path: '/mail/t2',
      search: '?referral_code=new',
      hash: '#frag',
    });
  });

  it('a leave guard can keep a pane open', () => {
    const { router } = track(setup('/home/~/mail'));
    router.registerGuard('pane-2' as PaneId, PANE_ROUTE_LEVEL, () => false);
    expect(router.close('pane-2' as PaneId)).toBe(false);
    expect(router.panes()).toHaveLength(2);
  });

  it('shows the catch-all route in an unmatched pane and loads the others', () => {
    const { router, pane } = track(setup('/mail/t1/~/no/such'));
    expect(routeIds(router.entry(pane(0)))).toEqual(['mail', 'mail-thread']);
    expect(routeIds(router.entry(pane(1)))).toEqual(['not-found']);
  });

  it('takes over outside navigations into the panes', async () => {
    const { router, history, pane } = track(setup('/home'));
    await expect(history.navigate('/mail/t2')).resolves.toBe(false);
    expect(routeIds(router.entry(pane(0)))).toEqual(['mail', 'mail-thread']);
    expect(history.entries().map((entry) => entry.path)).toEqual([
      '/home',
      '/mail/t2',
    ]);
  });

  it('commits in the same tick without data preloads and waits for them within a budget', async () => {
    const preload = vi.fn(() => new Promise(() => {}));
    const routes = withPaneRoutes(
      defineRoute({ id: 'slow', path: 'slow', preload })
    );
    const { router, pane } = track(
      setup('/home', { routes, preloadBudgetMs: 5 })
    );
    expect(isPromise(router.navigatePane(pane(0), '/mail'))).toBe(false);

    const result = router.navigatePane(pane(0), '/slow');
    expect(isPromise(result)).toBe(true);
    expect(preload).toHaveBeenCalledWith(
      expect.objectContaining({ intent: 'navigate', params: {} })
    );
    await expect(result).resolves.toMatchObject({ status: 'committed' });
    expect(routeIds(router.entry(pane(0)))).toEqual(['slow']);
  });

  it('logs a preload that throws and still navigates', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const routes = withPaneRoutes(
      defineRoute({
        id: 'broken',
        path: 'broken',
        preload: () => {
          throw new Error('boom');
        },
      })
    );
    const { router, pane } = track(setup('/home', { routes }));
    expect(router.navigatePane(pane(0), '/broken')).toEqual({
      status: 'committed',
      pane: pane(0),
    });
    expect(error).toHaveBeenCalledWith(
      'Split route "broken" preload failed',
      expect.any(Error)
    );
  });

  it('writes search as a new entry or in place', () => {
    const { router, history, pane } = track(setup('/drive'));
    const first = router.entry(pane(0))!.id;
    router.updateSearch(
      pane(0),
      'drive',
      { sort: ['name'] },
      { history: 'replace' }
    );
    expect(router.entry(pane(0))!.id).toBe(first);
    expect(history.read().search).toBe('?s0.drive.sort=name');
    expect(history.entries()).toHaveLength(1);

    router.updateSearch(pane(0), 'drive', { sort: ['date'] });
    expect(router.entry(pane(0))!.id).not.toBe(first);
    expect(history.entries()).toHaveLength(2);
  });

  it('jumps back to the nearest matching entry', () => {
    const { router, pane } = track(setup('/home'));
    router.navigatePane(pane(0), '/mail');
    router.navigatePane(pane(0), '/drive');
    expect(
      router.goBackTo(pane(0), (entry) => routeIds(entry)?.[0] === 'home')
    ).toBe(true);
    expect(routeIds(router.entry(pane(0)))).toEqual(['home']);
    expect(router.goBackTo(pane(0), () => true)).toBe(false);
  });

  it('removing entries cancels a pending traversal in that pane', async () => {
    const { router, pane } = track(setup('/home'));
    router.navigatePane(pane(0), '/mail');
    router.navigatePane(pane(0), '/drive');
    router.registerGuard(pane(0), PANE_ROUTE_LEVEL, never);
    const back = router.navigatePane(pane(0), -1);
    expect(routeIds(router.pending(pane(0))?.to)).toEqual(['mail']);

    const isMail = (entry: Entry) => routeIds(entry)?.[0] === 'mail';
    expect(router.removeEntries(pane(0), isMail)).toBe(true);
    await expect(back).resolves.toEqual({ status: 'cancelled' });
    expect(router.pending(pane(0))).toBeUndefined();
    expect(routeIds(router.entry(pane(0)))).toEqual(['drive']);
    expect(router.canGo(pane(0), -1)).toBe(true);
    expect(router.removeEntries(pane(0), isMail)).toBe(false);
  });

  it('rewrites the current entry in place', () => {
    const { router, history, pane } = track(setup('/md/draft'));
    const id = router.entry(pane(0))!.id;
    router.rewriteCurrent(pane(0), '/md/real');
    expect(router.entry(pane(0))!.id).toBe(id);
    expect(history.read().path).toBe('/md/real');
    expect(history.entries()).toHaveLength(1);
  });

  it('builds a single-pane href', () => {
    const { router, pane } = track(setup('/home/~/mail/t1'));
    expect(router.href(pane(1))).toBe('/mail/t1');
  });
});

describe('split router while other work is in flight', () => {
  it('keeps the entry an outside navigation came from when the new view redirects in place', async () => {
    const { router, history, pane } = track(setup('/home'));
    const stopRedirecting = createRoot((dispose) => {
      createEffect(() => {
        const showsDrive = routeIds(router.entry(pane(0)))?.[0] === 'drive';
        if (!showsDrive) return;

        untrack(() => router.navigatePane(pane(0), '/mail', { replace: true }));
      });

      return dispose;
    });

    await history.navigate('/drive');
    await router.settled();
    stopRedirecting();

    expect(history.entries().map((entry) => entry.path)).toEqual([
      '/home',
      '/mail',
    ]);
    expect(routeIds(router.entry(pane(0)))).toEqual(['mail']);
  });

  it('lets an outside navigation replace an async initial load, then runs the open waiting on it', async () => {
    const { router, history, pane } = track(
      setup('/home', { middleware: [async () => {}] })
    );
    const opened = router.open('/mail', { newPane: true });
    void history.navigate('/drive');

    await expect(opened).resolves.toMatchObject({ status: 'committed' });
    await router.settled();
    expect(router.ready()).toBe(true);
    expect(routeIds(router.entry(pane(0)))).toEqual(['drive']);
    expect(routeIds(router.entry(pane(1)))).toEqual(['mail']);
  });

  it('holds an open that follows an outside navigation during the initial load', async () => {
    const { router, history } = track(
      setup('/home', { middleware: [async () => {}] })
    );
    void history.navigate('/drive');
    const opened = router.open('/mail', { newPane: true });

    await expect(opened).resolves.toMatchObject({ status: 'committed' });
    await router.settled();
    expect(router.ready()).toBe(true);
    expect(router.panes().map((id) => routeIds(router.entry(id))?.[0])).toEqual(
      ['drive', 'mail']
    );
  });

  it('asks guards registered above the first route before closing the pane', () => {
    const { router, pane } = track(setup('/home/~/mail'));
    router.registerGuard(pane(1), PANE_LEVEL, () => false);

    expect(router.close(pane(1))).toBe(false);
    expect(router.panes()).toHaveLength(2);
  });

  it('puts the URL back past every Back that a refused Back replaced', async () => {
    const { router, history, pane } = track(setup('/home'));
    router.navigatePane(pane(0), '/mail');
    router.navigatePane(pane(0), '/drive');
    const answers: ((allowed: boolean) => void)[] = [];
    router.registerGuard(pane(0), PANE_ROUTE_LEVEL, ({ cause }) => {
      if (cause !== 'external') return true;

      return new Promise<boolean>((resolve) => answers.push(resolve));
    });

    history.back();
    history.back();
    answers[1]!(false);
    await router.settled();

    expect(routeIds(router.entry(pane(0)))).toEqual(['drive']);
    expect(history.index()).toBe(2);
    expect(history.read().path).toBe('/drive');
  });

  it('cancels the pending departure of a pane it activates for a claim', async () => {
    const { router, activated, pane } = track(setup('/md/d1/~/home'));
    let leave: (allowed: boolean) => void = () => {};
    router.registerGuard(
      pane(0),
      PANE_ROUTE_LEVEL,
      () =>
        new Promise<boolean>((resolve) => {
          leave = resolve;
        })
    );

    const departure = router.navigatePane(pane(0), '/drive');
    expect(router.navigatePane(pane(1), '/md/d1')).toEqual({
      status: 'activated',
      owner: pane(0),
    });
    leave(true);

    await expect(departure).resolves.toEqual({ status: 'cancelled' });
    expect(routeIds(router.entry(pane(0)))).toEqual(['block']);
    expect(activated).toEqual([pane(0)]);
  });

  it('carries the search a navigation asked for to the pane already showing its resource', async () => {
    const { router, activated, pane } = track(setup('/drive/md/d1/~/home'));

    expect(
      router.navigatePane(pane(1), '/drive/md/d1', {
        search: { drive: { sort: ['name'] } },
      })
    ).toEqual({ status: 'activated', owner: pane(0) });
    await router.settled();

    expect(activated).toEqual([pane(0)]);
    expect(router.entry(pane(0))?.location.search).toEqual({
      drive: { sort: ['name'] },
    });
    expect(routeIds(router.entry(pane(1)))).toEqual(['home']);
  });

  it('delivers repeated navigation to an inline owner without replacing its surrounding route', () => {
    const { router, pane } = track(setup('/home'));
    const owner = Symbol('preview');
    const destinations: Readonly<Entry>[] = [];
    const unregister = router.claims.register(() => [
      {
        owner,
        pane: pane(0),
        claim: 'block:md:d1',
        activate: (destination) => {
          if (destination) destinations.push(destination);
        },
      },
    ]);

    for (const token of ['first', 'second']) {
      expect(
        router.navigatePane(pane(0), '/drive/md/d1', {
          search: { drive: { sort: [token] } },
        })
      ).toEqual({ status: 'activated', owner });
    }

    expect(destinations.map((entry) => entry.location.search)).toEqual([
      { drive: { sort: ['first'] } },
      { drive: { sort: ['second'] } },
    ]);
    expect(routeIds(router.entry(pane(0)))).toEqual(['home']);
    unregister();
    expect(router.navigatePane(pane(0), '/drive/md/d1')).toMatchObject({
      status: 'committed',
    });
  });

  it('delivers a route target to a non-pane owner before activation instead of opening another pane', () => {
    const { router, pane } = track(setup('/home'));
    const owner = Symbol('popover');
    const activate = vi.fn<(destination?: Readonly<Entry>) => void>();
    router.claims.register(() => [{ owner, claim: 'block:md:d1', activate }]);

    expect(
      router.open(
        '/drive/md/d1',
        { newPane: true, source: pane(0) },
        {
          search: { drive: { sort: ['name'] } },
        }
      )
    ).toEqual({ status: 'activated', owner });
    expect(activate.mock.calls[0]?.[0]?.location.search).toEqual({
      drive: { sort: ['name'] },
    });
    expect(router.panes()).toHaveLength(1);
  });

  it('keeps an owner’s pending navigation that stays on the claimed resource', async () => {
    let release: () => void = () => {};
    const { router, pane } = track(
      setup('/drive/md/d1/~/home', {
        middleware: [
          ({ cause }) => {
            if (cause !== 'search') return;

            return new Promise<void>((resolve) => {
              release = resolve;
            });
          },
        ],
      })
    );
    await router.settled();

    const sorting = router.updateSearch(pane(0), 'drive', { sort: ['date'] });
    router.navigatePane(pane(1), '/drive/md/d1');
    release();

    await expect(sorting).resolves.toMatchObject({ status: 'committed' });
    expect(router.entry(pane(0))?.location.search).toEqual({
      drive: { sort: ['date'] },
    });
  });

  it('counts opens still in flight against the policy’s limit', async () => {
    const { router } = track(
      setup(
        '/home',
        {
          middleware: [
            ({ path }) => (path === '/home' ? undefined : Promise.resolve()),
          ],
        },
        createTestPolicy({ maxPanes: 2 })
      )
    );
    const source = 'pane-1' as PaneId;

    const first = router.open('/mail', { newPane: true, source });
    const second = router.open('/drive', { newPane: true, source });
    await Promise.all([first, second]);

    expect(router.panes()).toHaveLength(2);
  });

  it('turns down a location it cannot write, leaving the pane and later writes intact', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { router, history, pane } = track(setup('/drive'));
    const tooLong = 'x'.repeat(17_000);

    expect(router.updateSearch(pane(0), 'drive', { sort: [tooLong] })).toEqual({
      status: 'cancelled',
    });
    expect(
      router.rewriteCurrent(pane(0), { route: { id: 'missing' } })
    ).toEqual({
      status: 'cancelled',
    });
    expect(routeIds(router.entry(pane(0)))).toEqual(['drive']);
    expect(router.entry(pane(0))?.location.search).toBeUndefined();

    expect(router.navigatePane(pane(0), '/mail')).toMatchObject({
      status: 'committed',
    });
    expect(history.read().path).toBe('/mail');
    expect(error).toHaveBeenCalled();
    expect(error).not.toHaveBeenCalledWith(
      'Split router could not commit a navigation',
      expect.anything()
    );
  });

  it('drops a search value from the URL that is too long to write back', () => {
    const tooLong = 'x'.repeat(17_000);
    const { router, pane } = track(setup(`/drive?s0.drive.sort=${tooLong}`));

    expect(routeIds(router.entry(pane(0)))).toEqual(['drive']);
    expect(router.entry(pane(0))?.location.search).toBeUndefined();
  });

  it('reports a refused jump back as false, and a back-to close then keeps the pane', async () => {
    const closeLast: SplitCloseAction = {
      type: 'back-to',
      to: (entry) => routeIds(entry)?.[0] === 'home',
      otherwise: {
        type: 'navigate',
        destination: location('mail'),
        replace: true,
      },
    };
    const { router, pane } = track(
      setup('/home', {}, createTestPolicy({ closeLast }))
    );
    router.navigatePane(pane(0), '/drive');
    router.registerGuard(
      pane(0),
      PANE_ROUTE_LEVEL,
      ({ to }) => routeIds(to)?.[0] !== 'home'
    );

    const isHome = (entry: Entry) => routeIds(entry)?.[0] === 'home';
    expect(await router.goBackTo(pane(0), isHome)).toBe(false);
    expect(await router.close(pane(0))).toBe(false);
    expect(routeIds(router.entry(pane(0)))).toEqual(['drive']);
  });

  it('turns down a close action that leads to no route', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const closeLast: SplitCloseAction = {
      type: 'navigate',
      destination: location('missing'),
    };
    const { router, history, pane } = track(
      setup('/drive', {}, createTestPolicy({ closeLast }))
    );

    expect(await router.close(pane(0))).toBe(false);
    expect(routeIds(router.entry(pane(0)))).toEqual(['drive']);
    expect(history.read().path).toBe('/drive');
    expect(error).toHaveBeenCalledWith(
      'Split router close action leads to no route',
      closeLast.destination
    );
  });

  it('writes a replace another pane makes while one commits after that commit’s push', async () => {
    const { router, history, pane } = track(setup('/home/~/home'));
    const stopRedirecting = createRoot((dispose) => {
      createEffect(() => {
        const showsDrive = routeIds(router.entry(pane(0)))?.[0] === 'drive';
        if (!showsDrive) return;

        untrack(() => router.navigatePane(pane(1), '/mail', { replace: true }));
      });

      return dispose;
    });

    router.navigatePane(pane(0), '/drive');
    await router.settled();
    stopRedirecting();

    expect(history.entries().map((entry) => entry.path)).toEqual([
      '/home/~/home',
      '/drive/~/mail',
    ]);
  });

  it('keeps a Back whose view redirects in place as it mounts', async () => {
    const { router, history, pane } = track(setup('/drive'));
    router.navigatePane(pane(0), '/mail');
    let armed = false;
    const stopRedirecting = createRoot((dispose) => {
      createEffect(() => {
        const showsDrive = routeIds(router.entry(pane(0)))?.[0] === 'drive';
        const redirects = armed && showsDrive;
        if (!redirects) return;

        untrack(() => router.navigatePane(pane(0), '/home', { replace: true }));
      });

      return dispose;
    });
    armed = true;

    history.back();
    await router.settled();
    stopRedirecting();

    expect(history.index()).toBe(0);
    expect(history.entries().map((entry) => entry.path)).toEqual([
      '/home',
      '/mail',
    ]);
    expect(routeIds(router.entry(pane(0)))).toEqual(['home']);
  });

  it('keeps navigating after the history adapter fails a write', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const history = createMemoryHistory('/home');
    let failNext = false;
    const flaky: HistoryAdapter = {
      ...history,
      write(location, writeOptions) {
        if (failNext) {
          failNext = false;
          throw new Error('write failed');
        }

        history.write(location, writeOptions);
      },
    };
    const { router, pane } = track(setup('/home', { history: flaky }));

    failNext = true;
    expect(router.navigatePane(pane(0), '/mail')).toEqual({
      status: 'cancelled',
    });
    expect(router.navigatePane(pane(0), '/drive')).toMatchObject({
      status: 'committed',
    });
    expect(history.read().path).toBe('/drive');
    expect(error).toHaveBeenCalledWith(
      'Split router could not commit a navigation',
      expect.any(Error)
    );
  });

  it('settles a URL navigation that arrives while an earlier one is being put back', async () => {
    const { history, adapter, landAll } = slowRevertHistory('/home');
    const { router, pane } = track(setup('/home', { history: adapter }));
    router.navigatePane(pane(0), '/mail');
    router.navigatePane(pane(0), '/drive');
    router.registerGuard(pane(0), PANE_ROUTE_LEVEL, ({ cause }) =>
      cause === 'external' ? never() : true
    );

    history.back();
    const navigated = router.navigatePane(pane(0), '/drive/folder/f1');
    history.back();
    await landAll();

    await expect(navigated).resolves.toMatchObject({ status: 'committed' });
    await expect(router.settled()).resolves.toBeUndefined();
    expect(history.read().path).toBe('/drive/folder/f1');
    expect(routeIds(router.entry(pane(0)))).toEqual(['drive', 'drive-folder']);
  });

  it('puts back a Back that arrives while others are put back before them', async () => {
    const { history, adapter, landAll } = slowRevertHistory('/home');
    const { router, pane } = track(setup('/home', { history: adapter }));
    router.navigatePane(pane(0), '/mail');
    router.navigatePane(pane(0), '/drive');
    router.navigatePane(pane(0), '/md/d1');
    let refuse: () => void = () => {};
    router.registerGuard(pane(0), PANE_ROUTE_LEVEL, ({ cause }) => {
      if (cause !== 'external') return true;

      return new Promise<boolean>((resolve) => {
        refuse = () => resolve(false);
      });
    });

    history.back();
    history.back();
    refuse();
    await new Promise((resolve) => setTimeout(resolve, 0));
    history.back();
    await landAll();
    await router.settled();

    expect(history.index()).toBe(3);
    expect(history.read().path).toBe('/md/d1');
    expect(routeIds(router.entry(pane(0)))).toEqual(['block']);
  });

  it('opens a pane that already shows the destination by activating it', () => {
    const { router, activated, pane } = track(setup('/mail/t1/~/home'));

    expect(router.open('/mail/t1', { pane: pane(0) })).toEqual({
      status: 'activated',
      owner: pane(0),
    });
    expect(activated).toEqual([pane(0)]);
  });

  it('checks again before running a waiting action that a new Back overtook', async () => {
    const { router, history, pane, paneStore } = track(setup('/home'));
    router.navigatePane(pane(0), '/mail');
    let allow: (allowed: boolean) => void = () => {};
    router.registerGuard(pane(0), PANE_ROUTE_LEVEL, ({ cause }) => {
      if (cause !== 'external') return true;

      return new Promise<boolean>((resolve) => {
        allow = resolve;
      });
    });
    let redirected = false;
    const stopRedirecting = createRoot((dispose) => {
      createEffect(() => {
        const showsDrive = routeIds(router.entry(pane(0)))?.[0] === 'drive';
        const redirects = showsDrive && !redirected;
        if (!redirects) return;

        redirected = true;
        untrack(() =>
          router.navigatePane(pane(0), '/drive/folder/f1', { replace: true })
        );
      });

      return dispose;
    });

    router.navigatePane(pane(0), '/drive');
    history.back();
    await Promise.resolve();
    await Promise.resolve();
    allow(true);
    await router.settled();
    stopRedirecting();

    expect(routeIds(router.entry(pane(0)))).toEqual(['drive', 'drive-folder']);
    expect(history.index()).toBe(2);
    expect(history.read().path).toBe('/drive/folder/f1');
    expect(paneStore.read(pane(0))?.index).toBe(2);
  });

  it('writes the URL again after the history adapter failed to write it', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const history = createMemoryHistory('/home');
    let failNext = false;
    const flaky: HistoryAdapter = {
      ...history,
      write(location, writeOptions) {
        if (failNext) {
          failNext = false;
          throw new Error('write failed');
        }

        history.write(location, writeOptions);
      },
    };
    const { router, pane } = track(setup('/home', { history: flaky }));

    failNext = true;
    router.navigatePane(pane(0), '/mail');
    router.rewriteCurrent(pane(0), '/mail');

    expect(history.read().path).toBe('/mail');
  });

  it('ignores a host location outside the router’s base', () => {
    vi.useFakeTimers();
    const { router, solid } = track(setupSolid('/app/mail'));
    vi.runAllTimers();

    solid.show('/elsewhere', undefined);
    vi.runAllTimers();

    expect(routeIds(router.entry(router.panes()[0]!))).toEqual(['mail']);
  });

  it('drops a URL write still queued when the router is disposed', () => {
    vi.useFakeTimers();
    const { router, solid, dispose } = setupSolid('/app/home');
    vi.runAllTimers();

    router.navigatePane(router.panes()[0]!, '/mail');
    dispose();
    vi.runAllTimers();

    expect(solid.calls.map(([to]) => to)).toEqual(['/home']);
  });

  it('asks leave guards when Back or Forward leaves the router’s routes', () => {
    vi.useFakeTimers();
    const { router, solid } = track(setupSolid('/app/home', ['/settings']));
    vi.runAllTimers();
    const guard = vi.fn(() => false);
    router.registerGuard(router.panes()[0]!, PANE_ROUTE_LEVEL, guard);

    expect(solid.pop(1).defaultPrevented).toBe(true);
    expect(guard).toHaveBeenCalledTimes(1);
    expect(solid.landed()).toBe('/app/home');

    guard.mockReturnValue(true);
    expect(solid.pop(1).defaultPrevented).toBe(false);
    expect(solid.landed()).toBe('/settings');
  });

  it('drops a queued write when a navigation leaves the router’s routes', () => {
    vi.useFakeTimers();
    const { router, solid } = track(setupSolid('/app/home'));
    vi.runAllTimers();

    router.navigatePane(router.panes()[0]!, '/mail');
    expect(solid.leave('/settings').defaultPrevented).toBe(false);
    vi.runAllTimers();

    expect(solid.calls.map(([to]) => to)).toEqual(['/home']);
  });

  it('moves the cursor on Back to an entry that looks like the current one', () => {
    const { router, history, paneStore, pane } = track(setup('/home'));
    router.navigatePane(pane(0), '/home', { props: { note: 1 } });
    expect(paneStore.read(pane(0))?.entries).toHaveLength(2);

    history.back();
    expect(paneStore.read(pane(0))?.index).toBe(0);
    expect(router.canGo(pane(0), -1)).toBe(false);

    history.forward();
    expect(paneStore.read(pane(0))?.index).toBe(1);
    expect(router.arrival(pane(0))).toBe('forward');
  });
});
