import { createRoot } from 'solid-js';
import { afterEach, describe, expect, it } from 'vitest';
import { createMemoryHistory } from '../history/memory';
import { createMemoryPaneStore } from '../panes/memory-store';
import { createSplitRouter } from '../router/create-router';
import { PANE_LEVEL } from '../router/leave-guards';
import type { Entry, PaneId } from '../routes/types';
import { appRoutes, createTestPolicy } from './fixtures';

function setup(url: string) {
  const history = createMemoryHistory(url);
  const paneStore = createMemoryPaneStore<Entry>();
  let created = 0;
  const { router, dispose } = createRoot((dispose) => ({
    router: createSplitRouter({
      routes: appRoutes,
      history,
      paneStore,
      policy: createTestPolicy().policy,
      createPaneId: () => `pane-${++created}` as PaneId,
    }),
    dispose,
  }));
  return {
    router,
    history,
    paneStore,
    pane: (index: number) => router.panes()[index]!,
    dispose: () => {
      router.dispose();
      dispose();
    },
  };
}

const routeIds = (entry: Entry | undefined) =>
  entry?.location.route.matches
    .map((match) => match.id)
    .filter((id) => id !== 'app');

let cleanup: (() => void) | undefined;
const track = <T extends { dispose: () => void }>(context: T) => {
  cleanup = context.dispose;
  return context;
};

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

describe('layout snapshot and restore', () => {
  it('restores a captured layout with every pane history and the URL', async () => {
    const { router, history, paneStore, pane } = track(setup('/home/~/drive'));
    await router.navigatePane(pane(0), '/mail/t1');
    const captured = router.layoutSnapshot();
    expect(captured.panes.map((item) => item.pane)).toEqual([
      'pane-1',
      'pane-2',
    ]);
    expect(captured.panes[0]).toMatchObject({ index: 1 });

    await router.navigate('/mail');
    expect(router.panes()).toEqual(['pane-1']);
    expect(routeIds(router.entry(pane(0)))).toEqual(['mail']);

    const result = await router.restoreLayout(captured);
    expect(result.status).toBe('committed');
    expect(router.panes()).toEqual(['pane-1', 'pane-2']);
    expect(routeIds(router.entry(pane(0)))).toEqual(['mail', 'mail-thread']);
    expect(routeIds(router.entry(pane(1)))).toEqual(['drive']);

    expect(history.entries().at(-1)?.path).toBe('/mail/t1/~/drive');

    // The first pane can still go back through its captured history.
    expect(paneStore.read(pane(0))?.entries).toHaveLength(2);
    expect(router.canGo(pane(0), -1)).toBe(true);
    await router.navigatePane(pane(0), -1);
    expect(routeIds(router.entry(pane(0)))).toEqual(['home']);
  });

  it('keeps a pane already showing its entry mounted across a restore', async () => {
    const { router, pane } = track(setup('/home/~/drive'));
    const captured = router.layoutSnapshot();
    const home = router.entry(pane(0));

    const result = await router.restoreLayout(captured);
    expect(result.status).toBe('committed');
    expect(router.entry(pane(0))).toBe(home);
  });

  it('a leave guard on a pane the restore removes can refuse it', async () => {
    const { router, pane } = track(setup('/home'));
    const captured = router.layoutSnapshot();
    await router.navigate('/mail/~/drive');
    expect(router.panes()).toHaveLength(2);

    const stop = router.registerGuard(pane(1), PANE_LEVEL, () => false);
    const result = await router.restoreLayout(captured);
    expect(result.status).toBe('cancelled');
    expect(router.panes()).toHaveLength(2);
    stop();

    const retried = await router.restoreLayout(captured);
    expect(retried.status).toBe('committed');
    expect(router.panes()).toHaveLength(1);
    expect(routeIds(router.entry(pane(0)))).toEqual(['home']);
  });

  it('restoring an empty capture is cancelled', async () => {
    const { router } = track(setup('/home'));
    const result = await router.restoreLayout({ panes: [] });
    expect(result.status).toBe('cancelled');
  });

  it('layoutHref encodes the captured panes, not the open ones', async () => {
    const { router } = track(setup('/home/~/drive'));
    const captured = router.layoutSnapshot();
    await router.navigate('/mail/t1');

    expect(router.layoutHref(captured)).toBe('/home/~/drive');
    expect(router.layoutHref(router.layoutSnapshot())).toBe('/mail/t1');
  });
});
