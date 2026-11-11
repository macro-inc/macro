import {
  createMemoryHistory,
  createMemoryPaneStore,
  createSplitRouter,
  type Entry,
  type PaneId,
  type SplitRouter,
} from '@app/lib/split-router';
import {
  appRoutes,
  createTestPolicy,
} from '@app/lib/split-router/tests/fixtures';
import { globalTabManager } from '@app/signal/tabLayout';
import { useHotKeyRoot } from '@core/hotkey/hotkeys';
import { setPressedKeys } from '@core/hotkey/state';
import { cleanup, render } from '@solidjs/testing-library';
import { afterEach, expect, it, vi } from 'vitest';
import { DesktopTabsController } from '../DesktopTabsController';
import type { TabLayoutHost } from '../tab-manager';

vi.mock('@core/constant/isMac', () => ({ IS_MAC: true }));
vi.mock('@core/mobile/isTouchDevice', () => ({ isTouchDevice: () => false }));
vi.mock('@core/util/platform', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@core/util/platform')>()),
  isPlatform: () => true,
}));
vi.mock('@tauri-apps/plugin-os', () => ({ type: () => 'macos' }));
vi.mock('@app/lib/analytics/posthog', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@app/lib/analytics/posthog')>()),
  useFeatureFlag: () => () => ({ enabled: true }),
}));
vi.mock('@core/context/user', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@core/context/user')>()),
  useUserId: () => () => `user-${crypto.randomUUID()}`,
}));

const host: TabLayoutHost = {
  tabTitle: () => undefined,
  activeSplitId: () => undefined,
  getSplit: () => undefined,
  splits: () => [],
  activateSplit: () => {},
};

// The controller scopes block handles to the active tab.
const manager = {
  ...host,
  getOrchestrator: () => ({ setBlockScope: () => {} }),
} as unknown as Parameters<typeof DesktopTabsController>[0]['manager'];

async function flush(router: SplitRouter) {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await router.settled();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/** Mounts the controller with three tabs, the last one active. */
async function setupThreeTabs() {
  let created = 0;
  const router = createSplitRouter({
    routes: appRoutes,
    history: createMemoryHistory('/mail'),
    paneStore: createMemoryPaneStore<Entry>(),
    policy: createTestPolicy().policy,
    createPaneId: () => `pane-${++created}` as PaneId,
  });

  render(() => {
    useHotKeyRoot();
    return <DesktopTabsController router={router} manager={manager} />;
  });

  const tabManager = globalTabManager()!;
  tabManager.newTab();
  await flush(router);
  tabManager.newTab();
  await flush(router);

  return { router, tabManager };
}

function pressWithCmd(key: string) {
  const event = new KeyboardEvent('keydown', {
    key,
    metaKey: true,
    bubbles: true,
    cancelable: true,
  });
  document.dispatchEvent(event);
  return event;
}

afterEach(() => {
  cleanup();
  setPressedKeys(new Set<string>());
});

it('jumps to tabs by number while Cmd stays held, with 9 as the last tab', async () => {
  const { router, tabManager } = await setupThreeTabs();
  const [first, second, third] = tabManager.tabs();

  pressWithCmd('1');
  await flush(router);
  expect(tabManager.activeTabId()).toBe(first!.id);

  // macOS sends no keyup for the digit while Cmd is down.
  pressWithCmd('2');
  await flush(router);
  expect(tabManager.activeTabId()).toBe(second!.id);

  pressWithCmd('9');
  await flush(router);
  expect(tabManager.activeTabId()).toBe(third!.id);

  router.dispose();
});

it('switches from inside a text field', async () => {
  const { router, tabManager } = await setupThreeTabs();
  const [first] = tabManager.tabs();
  const input = document.createElement('input');
  document.body.append(input);
  input.focus();

  const event = pressWithCmd('1');
  await flush(router);

  expect(event.defaultPrevented).toBe(true);
  expect(tabManager.activeTabId()).toBe(first!.id);

  input.remove();
  router.dispose();
});

it('leaves a number with no tab alone', async () => {
  const { router, tabManager } = await setupThreeTabs();
  const active = tabManager.activeTabId();

  const event = pressWithCmd('5');
  await flush(router);

  expect(event.defaultPrevented).toBe(false);
  expect(tabManager.activeTabId()).toBe(active);

  router.dispose();
});
