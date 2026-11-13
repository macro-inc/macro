import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@solidjs/testing-library';
import {
  createSignal,
  type JSX,
  type ParentProps,
  Show,
  useContext,
} from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import {
  SplitHeaderLeft,
  SplitHeaderRight,
} from '../split-layout/components/SplitHeader';
import { SplitPanel } from '../split-layout/components/SplitPanel';
import {
  SplitPanelContext,
  type SplitPanelContextType,
} from '../split-layout/context';
import type {
  SplitContent,
  SplitHandle,
  SplitId,
  SplitState,
} from '../split-layout/layoutManager';
import { MobileHeader } from './mobile-header';

const routeState = vi.hoisted(() => ({ externalChat: false }));

// Keep the production panel, header, portal contributions, and target refs.
// Collection data, routing, and unrelated chrome are outside this lifecycle test.
vi.mock('@components/app/side-panel', () => ({
  SidePanel: { Toggle: () => null },
  useSidePanel: () => undefined,
}));
vi.mock('@app/features/access-requests/context/visit', () => ({
  AccessRequestVisitProvider: (props: ParentProps) => props.children,
}));
vi.mock('@app/features/next-soup/create-soup-state', () => ({
  createSoupState: () => ({}),
}));
vi.mock('@app/features/next-soup/soup-context', () => ({
  SoupContextProvider: (props: ParentProps) => props.children,
  useSoup: () => ({ rows: () => [], focus: { index: () => 0 } }),
}));
vi.mock('@app/features/next-soup/soup-view/soup-view-context', () => ({
  SoupViewContextProvider: (props: ParentProps) => props.children,
}));
vi.mock('@app/features/next-soup/utils', () => ({
  openEntityInSplitFromUnifiedList: vi.fn(),
}));
vi.mock('@app/lib/split-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@app/lib/split-router')>()),
  useOptionalSplitRouter: () => ({
    entry: () => ({
      location: {
        route: {
          matches: routeState.externalChat ? [{ id: 'external-chat' }] : [],
        },
      },
    }),
  }),
  SplitRouter: {
    Outlet: (props: { fallback: ParentProps['children'] }) => props.fallback,
  },
}));
vi.mock('@app/signal/splitLayout', () => ({
  globalSplitManager: () => undefined,
}));
vi.mock('@components/app/GlobalAppState', () => ({
  useGlobalNotificationSource: () => undefined,
}));
vi.mock('@components/app/mobile/MobileEdgeFade', () => ({
  MobileTopEdgeFade: () => <div data-testid="top-edge-fade" />,
}));
vi.mock('@components/app/mobile/MobilePageActionRow', () => ({
  MobilePageActionRow: () => null,
}));
vi.mock('@components/app/split-panel', () => ({
  SplitPanelControllerProvider: (props: ParentProps) => props.children,
}));
vi.mock('@core/hotkey/hotkeys', () => ({
  useHotkeyDOMScope: () => [() => {}, 'test-split'],
}));
vi.mock('@core/constant/allBlocks', () => ({
  fileTypeToBlockName: () => 'md',
}));
vi.mock('@core/mobile/isTouchDevice', () => ({ isTouchDevice: () => true }));
vi.mock('@core/mobile/isMobile', () => ({ isMobile: () => true }));
vi.mock('@core/mobile/isNativeMobilePlatform', () => ({
  isNativeMobilePlatform: () => true,
}));
vi.mock('@core/mobile/safeAreaInsets', () => ({ getSafeAreaInset: () => 0 }));
vi.mock('@thisbeyond/solid-dnd', () => ({
  createDroppable: () => () => {},
  useDragDropContext: () => undefined,
}));
vi.mock('@entity', () => ({ isEntityDragEvent: () => false }));
vi.mock('@app/components/view-shell', () => ({ ViewBreadcrumbs: {} }));
vi.mock('@ui', async () => {
  const { cn } = await import('../../ui/utils/classname');
  const Container = (props: ParentProps) => <div>{props.children}</div>;
  return {
    Panel: Object.assign(Container, {
      Header: Container,
      Toolbar: Container,
      Body: Container,
    }),
    Button: (props: {
      children?: JSX.Element;
      disabled?: boolean;
      'aria-label'?: string;
      onClick?: () => void;
    }) => (
      <button
        type="button"
        disabled={props.disabled}
        aria-label={props['aria-label']}
        onClick={props.onClick}
      >
        {props.children}
      </button>
    ),
    Layer: Container,
    cn,
  };
});
vi.mock('../split-layout/layout', () => ({
  useSplitLayout: () => ({ getSplitCount: () => 1, insertSplit: vi.fn() }),
}));
vi.mock('../split-layout/registerSplitHotkeys', () => ({
  registerSplitHotkeys: () => {},
}));
vi.mock('../split-layout/utils/createSplitAutofocus', () => ({
  createSplitAutofocus: () => {},
}));
vi.mock('../split-layout/components/SplitHeaderContextMenu', () => ({
  SplitHeaderContextMenu: (props: ParentProps) => props.children,
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  routeState.externalChat = false;
});

it('mounts header contributions when chrome appears and follows its replacement without remounting the view', () => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  const [composable, setComposable] = createSignal(true);
  const [projectHeader, setProjectHeader] = createSignal(false);
  const id = 'header-target-test' as SplitId;
  const [content, setContent] = createSignal<SplitContent>({
    type: 'component',
    id: 'mail',
  });
  let mountedViews = 0;
  const replace = vi.fn();
  const goBack = vi.fn();
  const [canGoBack, setCanGoBack] = createSignal(false);
  let panel: SplitPanelContextType | undefined;
  const split: SplitState = {
    id,
    get content() {
      return content();
    },
    referredFrom: null,
    lastNavigationSource: null,
    lastNavigationCause: 'fresh',
    mount: {
      kind: 'component',
      name: 'mail',
      meta: {
        get splitPanelLayout() {
          return composable() ? 'composable' : undefined;
        },
      },
      updateMeta: () => {},
      element: () => {
        mountedViews += 1;
        panel = useContext(SplitPanelContext);
        return (
          <>
            <button
              type="button"
              onClick={() => setProjectHeader((value) => !value)}
            >
              Toggle project header
            </button>
            <Show when={projectHeader()}>
              <MobileHeader
                trailing={
                  <MobileHeader.Island>
                    <button type="button">Project details</button>
                  </MobileHeader.Island>
                }
              >
                <MobileHeader.Island>
                  <button type="button">Project title</button>
                </MobileHeader.Island>
              </MobileHeader>
            </Show>
            <button
              type="button"
              onClick={() => setComposable((value) => !value)}
            >
              Toggle header
            </button>
            <input aria-label="Retained view" />
            <SplitHeaderLeft>
              <button type="button">Unread</button>
            </SplitHeaderLeft>
            <SplitHeaderRight>
              <button type="button">Compose</button>
            </SplitHeaderRight>
          </>
        );
      },
    },
  };
  const handle: SplitHandle = {
    id,
    content,
    unregisterContentChangeListener: () => {},
    registerContentChangeListener: () => {},
    replace,
    adoptContentId: () => {},
    removeFromHistory: () => {},
    toggleSpotlight: () => {},
    setDisplayName: () => {},
    canGoForward: () => false,
    isSpotLight: () => false,
    isPopover: () => false,
    displayName: () => 'Mail',
    // The shell receives both ordinary history and direct-link availability.
    canGoBack,
    isActive: () => true,
    isFirst: () => true,
    goForward: () => {},
    isLast: () => true,
    activate: () => {},
    goBack,
    goBackTo: () => false,
    close: () => {},
    reset: () => {},
    previousContent: () => null,
    history: () => [content()],
    meta: () =>
      split.mount.kind === 'component' ? split.mount.meta : undefined,
    updateMeta: () => {},
    referredFrom: () => null,
    lastNavigationSource: () => null,
    lastNavigationCause: () => 'fresh',
    registerEntryStateCaptor: () => () => {},
    captureEntryState: () => {},
    currentEntryState: () => undefined,
    updateCurrentEntry: () => {},
  };
  const { container } = render(() => (
    <SplitPanel
      setPanelRef={() => {}}
      handle={handle}
      split={split}
      active
      index={0}
    />
  ));
  const retainedView = screen.getByRole('textbox', { name: 'Retained view' });
  const toggle = screen.getByRole('button', { name: 'Toggle header' });
  expect(container.querySelector('[data-split-header]')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Unread' })).toBeNull();

  const toggleProject = screen.getByRole('button', {
    name: 'Toggle project header',
  });
  fireEvent.click(toggleProject);
  const projectChrome = container.querySelector<HTMLElement>(
    '[data-split-header]'
  );
  expect(projectChrome).not.toBeNull();
  if (!projectChrome) throw new Error('Expected the project header to mount');
  expect(
    within(projectChrome).getByRole('button', { name: 'Project title' })
  ).toBeTruthy();
  expect(
    within(projectChrome).getByRole('button', { name: 'Project details' })
  ).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Unread' })).toBeNull();
  setContent({
    type: 'component',
    id: 'tasks',
    entryMetadata: {
      route: {
        matches: [
          { id: 'view-tasks', params: {} },
          {
            id: 'tasks-project',
            params: {
              projectId: '00000000-0000-4000-8000-000000000001',
              section: 'overview',
            },
          },
        ],
      },
    },
  });
  const back = within(projectChrome).getByRole('button', { name: /go back/i });
  expect(back.hasAttribute('disabled')).toBe(false);
  expect(
    back.closest('[data-header-island]')?.classList.contains('hidden')
  ).toBe(false);
  fireEvent.click(back);
  expect(replace).toHaveBeenCalledWith({
    mergeHistory: true,
    next: expect.objectContaining({
      entryMetadata: expect.objectContaining({
        route: expect.objectContaining({
          matches: expect.arrayContaining([
            expect.objectContaining({ id: 'tasks-projects' }),
          ]),
        }),
      }),
    }),
  });
  setCanGoBack(true);
  fireEvent.click(back);
  expect(goBack).toHaveBeenCalledOnce();
  expect(replace).toHaveBeenCalledOnce();
  expect(
    back.closest('[data-header-island]')?.classList.contains('hidden')
  ).toBe(false);
  setCanGoBack(false);
  setContent({ type: 'component', id: 'mail' });
  fireEvent.click(toggleProject);
  expect(projectChrome.isConnected).toBe(false);
  expect(panel?.layoutRefs.headerLeft).toBeUndefined();
  expect(panel?.layoutRefs.headerRight).toBeUndefined();
  expect(screen.getByRole('textbox', { name: 'Retained view' })).toBe(
    retainedView
  );

  fireEvent.click(toggle);
  const firstHeader = container.querySelector<HTMLElement>(
    '[data-split-header]'
  );
  expect(firstHeader).not.toBeNull();
  if (!firstHeader) throw new Error('Expected the first header to mount');
  expect(
    within(firstHeader).getByRole('button', { name: 'Unread' })
  ).toBeTruthy();
  expect(
    within(firstHeader).getByRole('button', { name: 'Compose' })
  ).toBeTruthy();

  fireEvent.click(toggle);
  expect(firstHeader.isConnected).toBe(false);
  expect(panel?.layoutRefs.headerLeft).toBeUndefined();
  expect(panel?.layoutRefs.headerRight).toBeUndefined();
  expect(screen.queryByRole('button', { name: 'Unread' })).toBeNull();

  fireEvent.click(toggle);
  const secondHeader = container.querySelector<HTMLElement>(
    '[data-split-header]'
  );
  expect(secondHeader).not.toBe(firstHeader);
  if (!secondHeader)
    throw new Error('Expected the replacement header to mount');
  expect(
    within(secondHeader).getByRole('button', { name: 'Unread' })
  ).toBeTruthy();
  expect(
    within(secondHeader).getByRole('button', { name: 'Compose' })
  ).toBeTruthy();
  expect(
    within(firstHeader).queryByRole('button', { name: 'Unread' })
  ).toBeNull();
  expect(screen.getByRole('textbox', { name: 'Retained view' })).toBe(
    retainedView
  );
  routeState.externalChat = true;
  setContent({ type: 'component', id: 'external' });
  expect(screen.getByRole('button', { name: 'Unread' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Compose' })).toBeTruthy();

  expect(screen.getByTestId('top-edge-fade')).toBeTruthy();

  routeState.externalChat = false;
  setContent({ type: 'component', id: 'external' });
  expect(container.querySelector('[data-split-header]')).toBeNull();
  expect(screen.queryByTestId('top-edge-fade')).toBeNull();
  expect(screen.getByRole('textbox', { name: 'Retained view' })).toBe(
    retainedView
  );
  expect(mountedViews).toBe(1);
});
