import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@solidjs/testing-library';
import { createSignal, type ParentProps, useContext } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { SplitHeaderLeft, SplitHeaderRight } from '../components/SplitHeader';
import { SplitPanel } from '../components/SplitPanel';
import { SplitPanelContext, type SplitPanelContextType } from '../context';
import type { SplitHandle, SplitId, SplitState } from '../layoutManager';

const device = vi.hoisted(() => ({ touch: true }));

// Keep the production panel, header, portal contributions, and target refs.
// Collection data, routing, and unrelated chrome are outside this lifecycle test.
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
vi.mock('@app/lib/split-router', () => ({
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
  MobileTopEdgeFade: () => null,
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
vi.mock('@core/mobile/isTouchDevice', () => ({
  isTouchDevice: () => device.touch,
}));
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
vi.mock('@ui', () => {
  const Container = (props: ParentProps) => <div>{props.children}</div>;
  return {
    Panel: Object.assign(Container, {
      Header: Container,
      Toolbar: Container,
      Body: Container,
    }),
    Button: Container,
    Layer: Container,
    cn: () => '',
  };
});
vi.mock('../layout', () => ({
  useSplitLayout: () => ({ getSplitCount: () => 1, insertSplit: vi.fn() }),
}));
vi.mock('../registerSplitHotkeys', () => ({ registerSplitHotkeys: () => {} }));
vi.mock('../utils/createSplitAutofocus', () => ({
  createSplitAutofocus: () => {},
}));
vi.mock('../components/SplitHeaderContextMenu', () => ({
  SplitHeaderContextMenu: (props: ParentProps) => props.children,
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it.each([true, false])('keeps header targets (touch=%s)', (touch) => {
  device.touch = touch;
  const resize = new Map<Element, () => void>();
  vi.stubGlobal(
    'ResizeObserver',
    class implements ResizeObserver {
      constructor(private callback: ResizeObserverCallback) {}
      observe(target: Element) {
        resize.set(target, () =>
          this.callback(
            [
              {
                target,
                borderBoxSize: [{ inlineSize: 1000, blockSize: 48 }],
                contentBoxSize: [],
                devicePixelContentBoxSize: [],
                contentRect: new DOMRectReadOnly(0, 0, 1000, 48),
              },
            ],
            this
          )
        );
      }
      unobserve(target: Element) {
        resize.delete(target);
      }
      disconnect() {}
    }
  );
  const [composable, setComposable] = createSignal(true);
  const id = 'header-target-test' as SplitId;
  const content = { type: 'component', id: 'mail' } as const;
  let mountedViews = 0;
  let panel: SplitPanelContextType | undefined;
  const split: SplitState = {
    id,
    content,
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
    content: () => content,
    unregisterContentChangeListener: () => {},
    registerContentChangeListener: () => {},
    replace: () => {},
    adoptContentId: () => {},
    removeFromHistory: () => {},
    toggleSpotlight: () => {},
    setDisplayName: () => {},
    canGoForward: () => false,
    isSpotLight: () => false,
    isPopover: () => false,
    displayName: () => 'Mail',
    canGoBack: () => false,
    isActive: () => true,
    isFirst: () => true,
    goForward: () => {},
    isLast: () => true,
    activate: () => {},
    goBack: () => {},
    goBackTo: () => false,
    close: () => {},
    reset: () => {},
    previousContent: () => null,
    history: () => [content],
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

  fireEvent.click(toggle);
  const firstHeader = container.querySelector<HTMLElement>(
    '[data-split-header]'
  );
  expect(firstHeader).not.toBeNull();
  if (!firstHeader) throw new Error('Expected the first header to mount');
  const panelElement = container.querySelector<HTMLElement>('[data-split-id]');
  expect(panelElement?.style.getPropertyValue('--split-header-height')).toBe(
    '0px'
  );
  const measureHeader = resize.get(firstHeader);
  if (!measureHeader) throw new Error('Expected the header size observer');
  measureHeader();
  expect(panelElement?.style.getPropertyValue('--split-header-height')).toBe(
    touch ? '48px' : '0px'
  );

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
  expect(mountedViews).toBe(1);
});
