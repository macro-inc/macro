import { spreadsheetLocationUpdates } from '@app/features/block-spreadsheet/spreadsheet-route';
import {
  createMemoryHistory,
  createMemoryPaneStore,
  createSplitRouter,
  type Entry,
} from '@app/lib/split-router';
import { paneRoute } from '@app/routes/app-route';
import {
  appRoute,
  homeSplitRoute,
  legacyContentRoute,
  notFoundRoute,
} from '@app/routes/routes';
import { chatLocationUpdates } from '@block-chat/chat-route';
import type { BlockOrchestrator } from '@core/orchestrator';
import { cleanup, render } from '@solidjs/testing-library';
import { createEffect, createRoot, onMount } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { createAppSplitLayout } from '../split-router/app-content';
import { createAppPanePolicy } from '../split-router/app-pane-policy';
import {
  resolveContentLocation,
  splitContentFromLocation,
} from '../split-router/legacy-route';

const mocks = vi.hoisted(() => ({
  mounts: vi.fn(),
  navigation: vi.fn(),
  acquire: vi.fn(),
  release: vi.fn(),
}));

function Feature(props: {
  params?: Record<string, string>;
  navigationRequest?: string | number;
  routeOwned?: boolean;
}) {
  onMount(mocks.mounts);
  createEffect(() =>
    mocks.navigation(props.params, props.navigationRequest, props.routeOwned)
  );
  return (
    <div>
      <span data-testid="location">
        {props.params?.message_id ?? props.params?.comment_id}
      </span>
      <input aria-label="Draft" />
    </div>
  );
}

vi.mock('@block-chat/ChatBlock', () => ({ ChatBlock: Feature }));
vi.mock('@app/features/block-spreadsheet/SpreadsheetBlock', () => ({
  default: Feature,
}));
vi.mock('../componentRegistry', () => ({
  resolveComponent: () => ({ element: () => null }),
}));
vi.mock('@core/util/createControlledOpenSignal', () => ({
  useFocusLock: () => ({ acquire: mocks.acquire, release: mocks.release }),
}));

const disposers: Array<() => void> = [];
afterEach(() => {
  cleanup();
  for (const dispose of disposers.splice(0)) dispose();
  vi.clearAllMocks();
});
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function setup() {
  return createRoot((dispose) => {
    let manager: ReturnType<typeof createAppSplitLayout> | undefined;
    const home = { route: paneRoute({ id: 'view-home', params: {} }) };
    const router = createSplitRouter({
      routes: {
        definitions: [
          {
            ...appRoute,
            children: [homeSplitRoute, legacyContentRoute, notFoundRoute],
          },
        ],
        defaultRoute: () => home.route,
      },
      history: createMemoryHistory('/home'),
      paneStore: createMemoryPaneStore<Entry>(),
      policy: createAppPanePolicy({
        manager: () => manager,
        toContent: splitContentFromLocation,
        defaultLocation: () => home,
        stacked: () => false,
      }),
    });
    const createBlockInstance = vi.fn();
    const getBlockHandle = vi.fn();
    const orchestrator = {
      createBlockInstance,
      getBlockHandle,
    } as unknown as BlockOrchestrator;
    manager = createAppSplitLayout(orchestrator, {
      router,
      toLocation: (content) => resolveContentLocation(router.routes, content),
      toContent: splitContentFromLocation,
    });
    disposers.push(() => {
      router.dispose();
      dispose();
    });
    return { manager, router, createBlockInstance, getBlockHandle };
  });
}

it.each([
  ['chat', 'message_id'],
  ['spreadsheet', 'comment_id'],
] as const)(
  'reuses an open %s popover and delivers targets without handles or remounting',
  async (type, key) => {
    const { manager, router, createBlockInstance, getBlockHandle } = setup();
    const id = '00000000-0000-4000-8000-000000000001';
    const popover = manager.createPopoverSplit({
      content: { type, id, params: { [key]: 'initial' } },
    });
    expect(popover).toBeDefined();
    const mount = manager.popovers().get(popover!.id)!.mount;
    const view = render(mount.element);
    await flush();
    const draft = view.getByLabelText('Draft');
    expect(view.getByTestId('location').textContent).toBe('initial');
    const updates =
      type === 'chat' ? chatLocationUpdates : spreadsheetLocationUpdates;
    for (const token of ['first', 'second']) {
      manager.openWithSplit(
        { type, id },
        { search: updates(id, { [key]: 'target' }, token) }
      );
      await router.settled();
      await flush();
      expect(view.getByTestId('location').textContent).toBe('target');
    }
    expect(view.getByLabelText('Draft')).toBe(draft);
    expect(mocks.mounts).toHaveBeenCalledTimes(1);
    expect(mocks.navigation.mock.calls.at(-1)?.[1]).not.toBe(
      mocks.navigation.mock.calls.at(-2)?.[1]
    );
    expect(mocks.navigation.mock.calls.at(-1)?.[2]).toBe(false);
    expect(manager.getActivePopovers()).toHaveLength(1);
    expect(manager.activeSplit()?.content()).toMatchObject({
      type: 'component',
      id: 'home',
    });
    expect(createBlockInstance).not.toHaveBeenCalled();
    expect(getBlockHandle).not.toHaveBeenCalled();

    popover!.close();
    expect(router.claims.holderOf(`block:${type}:${id}`)).toBeUndefined();
    expect(manager.getActivePopovers()).toHaveLength(0);
    manager.openWithSplit(
      { type, id },
      { search: updates(id, { [key]: 'after-close' }) }
    );
    await router.settled();
    expect(manager.activeSplit()?.content()).toMatchObject({ type, id });
  }
);
