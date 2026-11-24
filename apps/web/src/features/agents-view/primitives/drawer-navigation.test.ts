import {
  createMemoryHistory,
  createMemoryPaneStore,
  createSplitRouter,
  defineRoute,
  defineRoutes,
} from '@app/lib/split-router';
import { createTestPolicy } from '@app/lib/split-router/tests/fixtures';
import { createRoot } from 'solid-js';
import { expect, it } from 'vitest';
import { enteredFromWorkspaceDrawer } from './drawer-navigation';

it('uses the current entry origin even when a drawer replaces the first entry', () => {
  expect(enteredFromWorkspaceDrawer({ referredFrom: 'agents' })).toBe(true);
  expect(enteredFromWorkspaceDrawer({ referredFrom: 'sidebar' })).toBe(false);
  expect(enteredFromWorkspaceDrawer({ referredFrom: 'kommand-menu' })).toBe(
    false
  );
  expect(enteredFromWorkspaceDrawer(undefined)).toBe(false);
});

it('restores the correct drawer or external origin through real Back and Forward navigation', async () => {
  const { router, dispose } = createRoot((dispose) => ({
    dispose,
    router: createSplitRouter({
      routes: defineRoutes({
        defaultRoute: () => ({
          matches: [
            { id: 'app', params: {} },
            { id: 'agents', params: {} },
          ],
        }),
        definitions: [
          defineRoute({
            id: 'app',
            children: [
              defineRoute({ id: 'agents', path: 'agents' }),
              defineRoute({ id: 'routines', path: 'routines' }),
            ],
          }),
        ],
      }),
      history: createMemoryHistory('/agents'),
      paneStore: createMemoryPaneStore(),
      policy: createTestPolicy().policy,
    }),
  }));
  try {
    const pane = router.panes()[0]!;
    const fromDrawer = () =>
      enteredFromWorkspaceDrawer(router.entry(pane)?.meta);
    expect(fromDrawer()).toBe(false);
    await router.navigatePane(pane, '/routines', {
      meta: { referredFrom: 'agents' },
    });
    expect(fromDrawer()).toBe(true);
    await router.navigatePane(pane, '/agents', {
      meta: { referredFrom: 'kommand-menu' },
    });
    expect(fromDrawer()).toBe(false);
    await router.navigatePane(pane, '/routines', {
      meta: { referredFrom: 'agents' },
    });
    expect(fromDrawer()).toBe(true);
    await router.navigatePane(pane, -1);
    expect(fromDrawer()).toBe(false);
    await router.navigatePane(pane, -1);
    expect(fromDrawer()).toBe(true);
    await router.navigatePane(pane, 1);
    expect(fromDrawer()).toBe(false);
    await router.navigatePane(pane, 1);
    expect(fromDrawer()).toBe(true);
    await router.navigatePane(pane, '/agents');
    await router.navigatePane(pane, '/routines', {
      meta: { referredFrom: 'sidebar' },
    });
    expect(fromDrawer()).toBe(false);
  } finally {
    router.dispose();
    dispose();
  }
});
