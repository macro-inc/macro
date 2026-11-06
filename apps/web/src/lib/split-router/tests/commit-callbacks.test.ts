import { createRoot } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory } from '../history/memory';
import { createSolidRouterHistory } from '../history/solid-router';
import { createMemoryPaneStore } from '../panes/memory-store';
import { createSplitRouter } from '../router/create-router';
import type { LeaveGuardContext, SplitRouterOptions } from '../router/types';
import { defineRoute } from '../routes/define';
import type { Entry } from '../routes/types';
import { createFakeSolidRouter } from './fake-solid-router';
import { appRoute, appRoutes, createTestPolicy, mailRoute } from './fixtures';

const disposers: (() => void)[] = [];

function setup(url = '/home', overrides: Partial<SplitRouterOptions> = {}) {
  const history = createMemoryHistory(url);
  const { router, dispose } = createRoot((dispose) => ({
    router: createSplitRouter({
      routes: appRoutes,
      history,
      paneStore: createMemoryPaneStore<Entry>(),
      policy: createTestPolicy().policy,
      ...overrides,
    }),
    dispose,
  }));
  disposers.push(() => {
    router.dispose();
    dispose();
  });
  return { router, history, pane: router.panes()[0]! };
}

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  vi.restoreAllMocks();
});

describe('leave guard commit callbacks', () => {
  it('publishes once after middleware and the destination and URL commit', async () => {
    const release = Promise.withResolvers<void>();
    const { router, history, pane } = setup('/home', {
      middleware: [
        ({ path }) => (path === '/mail' ? release.promise : undefined),
      ],
    });
    const published: { path: string; route: string | undefined }[] = [];
    router.registerGuard(pane, 1, ({ onCommit }) => {
      onCommit(() => {
        published.push({
          path: history.read().path,
          route: router.entry(pane)?.location.route.matches.at(-1)?.id,
        });
      });
      return true;
    });
    const navigation = router.navigatePane(pane, '/mail');
    expect(published).toEqual([]);
    release.resolve();
    expect(await navigation).toMatchObject({ status: 'committed' });
    expect(published).toEqual([{ path: '/mail', route: 'mail' }]);
    await router.settled();
    expect(published).toEqual([{ path: '/mail', route: 'mail' }]);
  });

  it('discards every callback when a later guard refuses', async () => {
    const { router, pane } = setup();
    const publish = vi.fn();
    router.registerGuard(pane, 1, ({ onCommit }) => {
      onCommit(publish);
      return true;
    });
    router.registerGuard(pane, 1, () => false);
    expect(await router.navigatePane(pane, '/mail')).toEqual({
      status: 'cancelled',
    });
    expect(publish).not.toHaveBeenCalled();
  });

  it('discards staged callbacks when middleware cancels', async () => {
    const { router, pane } = setup('/home', {
      middleware: [
        ({ path, cancel }) => (path === '/mail' ? cancel() : undefined),
      ],
    });
    const publish = vi.fn();
    router.registerGuard(pane, 1, ({ onCommit }) => {
      onCommit(publish);
      return true;
    });
    expect(await router.navigatePane(pane, '/mail')).toEqual({
      status: 'cancelled',
    });
    expect(publish).not.toHaveBeenCalled();
  });

  it('publishes when a middleware failure permits navigation to commit', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { router, pane } = setup('/home', {
      middleware: [
        ({ path }) => {
          if (path === '/mail') throw new Error('Middleware failed');
        },
      ],
    });
    const publish = vi.fn();
    router.registerGuard(pane, 1, ({ onCommit }) => {
      onCommit(publish);
      return true;
    });
    expect(await router.navigatePane(pane, '/mail')).toMatchObject({
      status: 'committed',
    });
    expect(publish).toHaveBeenCalledOnce();
  });

  it('discards staged callbacks when applying navigation fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { router, history, pane } = setup();
    vi.spyOn(history, 'write').mockImplementationOnce(() => {
      throw new Error('History write failed');
    });
    const publish = vi.fn();
    router.registerGuard(pane, 1, ({ onCommit }) => {
      onCommit(publish);
      return true;
    });
    expect(await router.navigatePane(pane, '/mail')).toEqual({
      status: 'cancelled',
    });
    expect(publish).not.toHaveBeenCalled();
    expect(await router.navigatePane(pane, '/drive')).toMatchObject({
      status: 'committed',
    });
    expect(publish).toHaveBeenCalledOnce();
  });

  it('still publishes when a failed preload permits navigation to commit', async () => {
    const failingMail = defineRoute({
      ...mailRoute,
      preload: () => Promise.reject(new Error('Preload failed')),
    });
    const { router, pane } = setup('/home', {
      routes: {
        ...appRoutes,
        definitions: [
          {
            ...appRoute,
            children: appRoute.children.map((route) =>
              route.id === mailRoute.id ? failingMail : route
            ),
          },
        ],
      },
    });
    const publish = vi.fn();
    router.registerGuard(pane, 1, ({ onCommit }) => {
      onCommit(publish);
      return true;
    });
    expect(await router.navigatePane(pane, '/mail')).toMatchObject({
      status: 'committed',
    });
    expect(publish).toHaveBeenCalledOnce();
  });

  it('ignores early and late registrations from a superseded guard', async () => {
    const release = Promise.withResolvers<boolean>();
    const finished = Promise.withResolvers<void>();
    const { router, pane } = setup();
    const publishStale = vi.fn();
    const publishCurrent = vi.fn();
    router.registerGuard(pane, 1, async ({ to, onCommit }) => {
      if (to?.location.route.matches.at(-1)?.id === 'mail') {
        onCommit(publishStale);
        const allowed = await release.promise;
        onCommit(publishStale);
        finished.resolve();
        return allowed;
      }
      onCommit(publishCurrent);
      return true;
    });
    const superseded = router.navigatePane(pane, '/mail');
    expect(await router.navigatePane(pane, '/drive')).toMatchObject({
      status: 'committed',
    });
    expect(await superseded).toEqual({ status: 'cancelled' });
    release.resolve(true);
    await finished.promise;
    expect(publishStale).not.toHaveBeenCalled();
    expect(publishCurrent).toHaveBeenCalledOnce();
  });

  it('discards callbacks after disposal even when the guard resolves later', async () => {
    const release = Promise.withResolvers<boolean>();
    const finished = Promise.withResolvers<void>();
    const { router, pane } = setup();
    const publish = vi.fn();
    router.registerGuard(pane, 1, async ({ onCommit }) => {
      onCommit(publish);
      const allowed = await release.promise;
      onCommit(publish);
      finished.resolve();
      return allowed;
    });
    const navigation = router.navigatePane(pane, '/mail');
    router.dispose();
    expect(await navigation).toEqual({ status: 'cancelled' });
    release.resolve(true);
    await finished.promise;
    expect(publish).not.toHaveBeenCalled();
  });

  it('does not publish when another pane owns the requested detail', async () => {
    const { router, pane } = setup('/home/~/drive/md/document-one');
    const publish = vi.fn();
    const original = router.entry(pane);
    router.registerGuard(pane, 1, ({ onCommit }) => {
      onCommit(publish);
      return true;
    });
    expect(
      await router.navigatePane(pane, '/drive/md/document-one')
    ).toMatchObject({ status: 'activated' });
    expect(router.entry(pane)).toBe(original);
    expect(publish).not.toHaveBeenCalled();
  });

  it('does not run leave callbacks for unchanged navigation', async () => {
    const { router, pane } = setup();
    const publish = vi.fn();
    router.registerGuard(pane, 1, ({ onCommit }) => {
      onCommit(publish);
      return true;
    });
    expect(await router.navigatePane(pane, '/home')).toMatchObject({
      status: 'unchanged',
    });
    expect(publish).not.toHaveBeenCalled();
  });

  it('publishes pane removal callbacks after the pane disappears', async () => {
    const { router, pane } = setup('/home/~/mail');
    const published: boolean[] = [];
    const destinations: (Entry | undefined)[] = [];
    router.registerGuard(pane, 1, ({ to, onCommit }) => {
      destinations.push(to);
      onCommit(() => published.push(router.panes().includes(pane)));
      return true;
    });
    expect(await router.remove(pane)).toBe(true);
    expect(destinations).toEqual([undefined]);
    expect(published).toEqual([false]);
  });

  it('discards callbacks from all panes when a whole-window navigation is refused', async () => {
    const { router, pane } = setup('/home/~/mail');
    const publish = vi.fn();
    router.registerGuard(pane, 1, ({ onCommit }) => {
      onCommit(publish);
      return true;
    });
    router.registerGuard(router.panes()[1]!, 1, () => false);
    expect(await router.navigate('/drive')).toEqual({ status: 'cancelled' });
    expect(publish).not.toHaveBeenCalled();
    expect(router.panes()).toHaveLength(2);
  });

  it('contains callback errors without cancelling the commit or skipping later callbacks', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { router, pane } = setup();
    const publish = vi.fn();
    router.registerGuard(pane, 1, ({ onCommit }) => {
      onCommit(() => {
        throw new Error('Capture publication failed');
      });
      onCommit(publish);
      return true;
    });
    expect(await router.navigatePane(pane, '/mail')).toMatchObject({
      status: 'committed',
    });
    expect(error).toHaveBeenCalledWith(
      'Split router commit callback failed',
      expect.any(Error)
    );
    expect(publish).toHaveBeenCalledOnce();
    expect(router.entry(pane)?.location.route.matches.at(-1)?.id).toBe('mail');
  });

  it('stops remaining callbacks when a callback disposes the router', async () => {
    const { router, pane } = setup();
    const publish = vi.fn();
    router.registerGuard(pane, 1, ({ onCommit }) => {
      onCommit(router.dispose);
      onCommit(publish);
      return true;
    });
    expect(await router.navigatePane(pane, '/mail')).toMatchObject({
      status: 'committed',
    });
    expect(publish).not.toHaveBeenCalled();
  });

  it('never publishes callbacks from host-leave permission checks', async () => {
    const solid = createFakeSolidRouter('/app/home');
    const { router, pane } = setup('/home', {
      history: createSolidRouterHistory({
        location: solid.location,
        navigate: solid.navigate,
        base: '/app',
        beforeLeave: solid.beforeLeave,
        landedPath: solid.landed,
      }),
    });
    const publish = vi.fn();
    const guard = vi.fn(({ onCommit }: LeaveGuardContext) => {
      onCommit(publish);
      return true;
    });
    router.registerGuard(pane, 1, guard);
    solid.leave('/outside-app');
    expect(guard).toHaveBeenCalledOnce();
    expect(publish).not.toHaveBeenCalled();
    expect(await router.navigatePane(pane, '/mail')).toMatchObject({
      status: 'committed',
    });
    expect(publish).toHaveBeenCalledOnce();
  });
});
