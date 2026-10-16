import {
  createMemoryHistory,
  createMemoryPaneStore,
  createSplitRouter,
  defineRoute,
  type PaneId,
  SplitRouter,
  type SplitRouterOptions,
} from '@app/lib/split-router';
import { createTestPolicy } from '@app/lib/split-router/tests/fixtures';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import {
  createSignal,
  type JSX,
  onCleanup,
  type ParentProps,
  splitProps,
} from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ListNav } from './list-nav';
import { SIDEBAR_NEXT_NAV_ITEMS } from './nav-items';
import { SidebarPrefsProvider } from './use-sidebar-prefs';

const mocks = vi.hoisted(() => ({
  activeContent: (): { type: 'component'; id: string } | undefined => undefined,
  activePane: (): PaneId | undefined => undefined,
  navigate: vi.fn(),
}));

vi.mock('@app/lib/analytics/analytics-context', () => ({
  useAnalytics: () => ({ track: vi.fn() }),
}));
vi.mock('@app/signal/splitLayout', () => ({
  globalSplitManager: () => ({
    activeSplit: () => ({
      id: mocks.activePane(),
      content: mocks.activeContent,
    }),
    returnFocus: vi.fn(),
  }),
}));
vi.mock('@components/app/app-sidebar/sidebar', () => ({
  navigateToSidebarView: mocks.navigate,
  sidebarContent: (id: string) => ({ type: 'component', id }),
  SidebarOpenInSplitMenu: (props: ParentProps) => props.children,
}));
vi.mock('@components/app/split-layout/layout', () => ({
  useSplitLayout: () => ({
    openWithSplit: vi.fn(),
    preloadContent: vi.fn(),
  }),
}));
vi.mock('@ui', async () => ({
  ...(await import('@ui/utils/classname')),
  Button: (
    props: JSX.ButtonHTMLAttributes<HTMLButtonElement> & { label: string }
  ) => {
    const [local, rest] = splitProps(props, ['label']);
    return <button type="button" aria-label={local.label} {...rest} />;
  },
}));

const home = SIDEBAR_NEXT_NAV_ITEMS.find((item) => item.id === 'home')!;
const agents = SIDEBAR_NEXT_NAV_ITEMS.find((item) => item.id === 'agents')!;

function setup(initial = '/home', agentsPreload?: () => Promise<void>) {
  const history = createMemoryHistory(initial);
  let router!: ReturnType<typeof createSplitRouter>;
  let focus!: (pane: PaneId) => void;
  render(() => {
    router = createSplitRouter({
      routes: {
        definitions: [
          defineRoute({
            id: 'app',
            children: [
              defineRoute({
                id: 'home',
                path: 'home',
                search: '*',
                children: [
                  defineRoute({ id: 'home-detail', path: 'detail/:id' }),
                ],
              }),
              defineRoute({ id: 'calendar', path: 'calendar', search: '*' }),
              defineRoute({
                id: 'agents',
                path: 'agents',
                preload: agentsPreload,
              }),
              defineRoute({
                id: 'agent-detail',
                path: 'agents/:id',
                search: '*',
              }),
              defineRoute({ id: 'settings', path: 'settings' }),
            ],
          }),
        ],
        defaultRoute: () => ({
          matches: [
            { id: 'app', params: {} },
            { id: 'home', params: {} },
          ],
        }),
      },
      history,
      paneStore: createMemoryPaneStore(),
      policy: createTestPolicy().policy,
    } satisfies SplitRouterOptions);
    const [focusedPane, setFocusedPane] = createSignal(router.panes()[0]!);
    focus = setFocusedPane;
    mocks.activePane = focusedPane;
    mocks.activeContent = () => {
      const entry = router.entry(focusedPane());
      const root = entry?.location.route.matches[1];
      const id =
        root?.id === 'agent-detail'
          ? `agents-session~agents~${root.params.id}`
          : root?.id;
      return id ? { type: 'component', id } : undefined;
    };
    mocks.navigate.mockImplementation(
      async ({ viewId, shiftKey }: { viewId: string; shiftKey: boolean }) => {
        const target = {
          location: {
            route: {
              matches: [
                { id: 'app', params: {} },
                { id: viewId, params: {} },
              ],
            },
          },
        } satisfies Parameters<typeof router.navigatePane>[1];
        const result = await (shiftKey
          ? router.open(
              target,
              { newPane: true, source: focusedPane() },
              { allowDuplicate: true }
            )
          : router.navigatePane(focusedPane(), target, {
              allowDuplicate: true,
            }));
        if (shiftKey && result.status === 'committed')
          setFocusedPane(result.pane);
      }
    );
    onCleanup(() => router.dispose());
    return (
      <SplitRouter.Root router={router}>
        <SidebarPrefsProvider>
          <ListNav item={home} />
          <ListNav item={agents} />
          <ListNav
            item={
              SIDEBAR_NEXT_NAV_ITEMS.find((item) => item.id === 'calendar')!
            }
          />
        </SidebarPrefsProvider>
      </SplitRouter.Root>
    );
  });
  return { router, history, focus };
}

function expectSelection(label?: string) {
  const buttons = screen.getAllByRole('button');
  const selected = buttons.filter((button) =>
    button.hasAttribute('data-active')
  );
  expect(selected).toHaveLength(label ? 1 : 0);
  for (const button of buttons) {
    const active = button.getAttribute('aria-label') === label;
    expect(button.hasAttribute('data-active')).toBe(active);
    expect(button.getAttribute('aria-current')).toBe(active ? 'page' : null);
  }
}

function press(label: string) {
  fireEvent.mouseDown(screen.getByRole('button', { name: label }), {
    button: 0,
  });
}

afterEach(() => {
  cleanup();
  mocks.navigate.mockReset();
});

describe('ListNav', () => {
  it('lets a rapid Home press supersede Agents without losing the current selection', () => {
    const { router, history } = setup();
    press('Agents');
    press('Home');

    expect(mocks.navigate).toHaveBeenCalledTimes(2);
    expect(
      router.entry(router.panes()[0]!)?.location.route.matches.at(-1)?.id
    ).toBe('home');
    expect(history.read().path).toBe('/home');
    expectSelection('Home');
  });

  it('ignores a late Agents preload after Home supersedes it', async () => {
    let finishPreload!: () => void;
    const preload = new Promise<void>((resolve) => {
      finishPreload = resolve;
    });
    const { router, history } = setup('/home', () => preload);
    press('Agents');
    expect(
      router.pending(router.panes()[0]!)?.to.location.route.matches.at(-1)?.id
    ).toBe('agents');
    expectSelection('Home');

    press('Home');
    finishPreload();
    await router.settled();
    expect(history.read().path).toBe('/home');
    expect(
      router.entry(router.panes()[0]!)?.location.route.matches.at(-1)?.id
    ).toBe('home');
    expectSelection('Home');
  });

  it('opens and selects a Shift destination when no later press supersedes it', async () => {
    const { router, history } = setup();
    fireEvent.mouseDown(screen.getByRole('button', { name: 'Agents' }), {
      button: 0,
      shiftKey: true,
    });
    await router.settled();

    expect(router.panes()).toHaveLength(2);
    expect(history.read().path).toBe('/home/~/agents');
    expectSelection('Agents');
  });

  it.each(['Home', 'Calendar'])(
    'cancels a pending Shift-open when %s is pressed afterward',
    async (label) => {
      let finishPreload!: () => void;
      const preload = new Promise<void>((resolve) => {
        finishPreload = resolve;
      });
      const { router, history } = setup('/home', () => preload);
      const original = router.panes()[0]!;
      fireEvent.mouseDown(screen.getByRole('button', { name: 'Agents' }), {
        button: 0,
        shiftKey: true,
      });
      expect(router.panes()).toEqual([original]);
      expectSelection('Home');

      press(label);
      finishPreload();
      await router.settled();

      expect(router.panes()).toEqual([original]);
      expect(history.read().path).toBe(
        label === 'Home' ? '/home' : '/calendar'
      );
      expectSelection(label);
    }
  );

  it('preserves a pending new pane requested from another split', async () => {
    let finishPreload!: () => void;
    const preload = new Promise<void>((resolve) => {
      finishPreload = resolve;
    });
    const { router, history } = setup('/home/~/settings', () => preload);
    const [first, second] = router.panes();
    const original = router.entry(first!);
    const opening = router.open('/agents', { newPane: true, source: second! });

    press('Home');
    finishPreload();
    await opening;
    await router.settled();

    expect(router.panes()).toHaveLength(3);
    expect(router.entry(first!)).toBe(original);
    expect(history.read().path).toBe('/home/~/settings/~/agents');
    expectSelection('Home');
  });

  it('preserves a selected nested detail and its search on an idle repeat', () => {
    const { router, history } = setup(
      '/home/detail/document?s0.home.tab=signal'
    );
    const pane = router.panes()[0]!;
    const entry = router.entry(pane);
    const before = router.history(pane);

    press('Home');

    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(router.entry(pane)).toBe(entry);
    expect(router.history(pane)).toEqual(before);
    expect(history.read().path).toBe('/home/detail/document');
    expect(history.read().search).toBe('?s0.home.tab=signal');
    expectSelection('Home');
  });

  it('preserves the selected Agents conversation instead of opening a new conversation', () => {
    const { router, history } = setup(
      '/agents/conversation?s0.agents.tab=changes'
    );
    const pane = router.panes()[0]!;
    const entry = router.entry(pane);
    expectSelection('Agents');

    press('Agents');

    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(router.entry(pane)).toBe(entry);
    expect(history.read().path).toBe('/agents/conversation');
    expect(history.read().search).toBe('?s0.agents.tab=changes');
    expectSelection('Agents');
  });

  it.each([
    ['/home/detail/document?s0.home.tab=signal', 'Home'],
    ['/calendar?s0.calendar.event=meeting', 'Calendar'],
  ])(
    'preserves %s when a selected %s press supersedes a preload',
    async (initial, label) => {
      let finishPreload!: () => void;
      const preload = new Promise<void>((resolve) => {
        finishPreload = resolve;
      });
      const { router, history } = setup(initial, () => preload);
      const pane = router.panes()[0]!;
      const originalEntry = router.entry(pane);
      const count = router.history(pane)?.entries.length;
      press('Agents');
      expect(router.pending(pane)).toBeDefined();
      expectSelection(label);

      press(label);
      finishPreload();
      await router.settled();

      expect(router.entry(pane)).toBe(originalEntry);
      expect(router.history(pane)?.entries).toHaveLength(count!);
      expect(router.pending(pane)).toBeUndefined();
      expect(`${history.read().path}${history.read().search}`).toBe(initial);
      expectSelection(label);
    }
  );

  it('cancels a pending leave guard when the shown workspace is pressed', async () => {
    const { router, history } = setup(
      '/home/detail/document?s0.home.tab=signal'
    );
    const pane = router.panes()[0]!;
    let allowLeave!: (allowed: boolean) => void;
    const guard = new Promise<boolean>((resolve) => {
      allowLeave = resolve;
    });
    router.registerGuard(pane, 1, () => guard);
    press('Agents');
    expect(router.pending(pane)).toBeDefined();

    press('Home');
    allowLeave(true);
    await router.settled();

    expect(history.read().path).toBe('/home/detail/document');
    expect(history.read().search).toBe('?s0.home.tab=signal');
    expectSelection('Home');
  });

  it('keeps the current view selected when a leave guard refuses navigation', () => {
    const { router, history } = setup();
    const pane = router.panes()[0]!;
    router.registerGuard(pane, 1, () => false);
    press('Agents');

    expect(mocks.navigate).toHaveBeenCalledOnce();
    expect(router.entry(pane)?.location.route.matches.at(-1)?.id).toBe('home');
    expect(history.read().path).toBe('/home');
    expectSelection('Home');
  });

  it('tracks history traversal instead of the last pressed destination', () => {
    const { router, history } = setup();
    press('Agents');
    expect(history.read().path).toBe('/agents');
    expectSelection('Agents');

    history.back();
    expect(history.read().path).toBe('/home');
    expect(
      router.entry(router.panes()[0]!)?.location.route.matches.at(-1)?.id
    ).toBe('home');
    expectSelection('Home');
    history.forward();
    expect(history.read().path).toBe('/agents');
    expectSelection('Agents');
  });

  it('selects the view in the focused split, not the first URL pane', () => {
    const { router, history, focus } = setup('/home/~/agents');
    const [first, second] = router.panes();
    expect(history.read().path).toBe('/home/~/agents');
    expect(router.entry(first!)?.location.route.matches.at(-1)?.id).toBe(
      'home'
    );
    expect(router.entry(second!)?.location.route.matches.at(-1)?.id).toBe(
      'agents'
    );
    expectSelection('Home');
    focus(second!);
    expectSelection('Agents');
    press('Home');
    expect(history.read().path).toBe('/home/~/home');
    expect(router.entry(first!)?.location.route.matches.at(-1)?.id).toBe(
      'home'
    );
    expect(router.entry(second!)?.location.route.matches.at(-1)?.id).toBe(
      'home'
    );
    expectSelection('Home');
    focus(first!);
    press('Agents');
    expect(history.read().path).toBe('/agents/~/home');
    expectSelection('Agents');
    focus(second!);
    expectSelection('Home');
  });

  it('leaves another split navigation alone when the shown workspace is pressed', async () => {
    let finishPreload!: () => void;
    const preload = new Promise<void>((resolve) => {
      finishPreload = resolve;
    });
    const { router, history } = setup(
      '/home/detail/document/~/settings?s0.home.tab=signal',
      () => preload
    );
    const [first, second] = router.panes();
    const entry = router.entry(first!);
    void router.navigatePane(second!, '/agents');
    expect(router.pending(second!)).toBeDefined();

    press('Home');
    finishPreload();
    await router.settled();

    expect(router.entry(first!)).toBe(entry);
    expect(router.entry(second!)?.location.route.matches.at(-1)?.id).toBe(
      'agents'
    );
    expect(history.read().search).toBe('?s0.home.tab=signal');
    expectSelection('Home');
  });

  it('handles a pointer press once and still accepts a keyboard-only click', () => {
    const { router, history } = setup();
    const agentsButton = screen.getByRole('button', { name: 'Agents' });
    fireEvent.mouseDown(agentsButton, { button: 0 });
    fireEvent.click(agentsButton, { button: 0, detail: 1 });
    expect(mocks.navigate).toHaveBeenCalledOnce();
    expectSelection('Agents');

    fireEvent.click(screen.getByRole('button', { name: 'Home' }), {
      button: 0,
      detail: 0,
    });
    expect(mocks.navigate).toHaveBeenCalledTimes(2);
    expect(history.read().path).toBe('/home');
    expect(router.history(router.panes()[0]!)?.entries).toHaveLength(3);
    expectSelection('Home');
  });

  it('does not reclaim the highlight when Settings becomes active again', () => {
    const { router, history } = setup('/settings');
    expectSelection();
    press('Agents');
    expect(history.read().path).toBe('/agents');
    expectSelection('Agents');

    // Settings opens from outside the rail list (the gear, a hotkey).
    router.navigatePane(router.panes()[0]!, '/settings');
    expect(history.read().path).toBe('/settings');
    expectSelection();
  });
});
