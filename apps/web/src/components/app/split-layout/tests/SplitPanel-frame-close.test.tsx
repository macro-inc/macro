import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal, type ParentProps } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { SplitPanel } from '../components/SplitPanel';
import type { SplitHandle, SplitId, SplitState } from '../layoutManager';

// Keep the production panel, header, and frame close button on desktop.
// Collection data, routing, and unrelated chrome are outside this test.
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
const [visibleSplits, setVisibleSplits] = createSignal(1);
vi.mock('@app/signal/splitLayout', () => ({
  globalSplitManager: () => ({ getVisibleSplitCount: visibleSplits }),
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
vi.mock('@core/mobile/isTouchDevice', () => ({ isTouchDevice: () => false }));
vi.mock('@core/mobile/isMobile', () => ({ isMobile: () => false }));
vi.mock('@core/mobile/isNativeMobilePlatform', () => ({
  isNativeMobilePlatform: () => false,
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
  const Button = (
    props: ParentProps<{
      'aria-label'?: string;
      label?: string;
      onClick?: (event: MouseEvent) => void;
    }>
  ) => (
    <button
      type="button"
      aria-label={props['aria-label'] ?? props.label}
      onClick={(event) => props.onClick?.(event)}
    >
      {props.children}
    </button>
  );
  return {
    Panel: Object.assign(Container, {
      Header: Container,
      Toolbar: Container,
      Body: Container,
    }),
    Button,
    ButtonGroup: Object.assign(Container, { Button }),
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
  setVisibleSplits(1);
  vi.unstubAllGlobals();
});

function renderDetailSplit() {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  const id = 'frame-close-test' as SplitId;
  const content = { type: 'md', id: 'doc-1' } as const;
  const split: SplitState = {
    id,
    content,
    referredFrom: null,
    lastNavigationCause: 'fresh',
    mount: {
      kind: 'component',
      name: 'md',
      meta: {},
      updateMeta: () => {},
      element: () => <p>Document</p>,
    },
  };
  const close = vi.fn();
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
    displayName: () => 'Document',
    canGoBack: () => false,
    isActive: () => true,
    isFirst: () => true,
    goForward: () => {},
    isLast: () => true,
    activate: () => {},
    goBack: () => {},
    goBackTo: () => false,
    close,
    reset: () => {},
    previousContent: () => null,
    history: () => [content],
    meta: () => undefined,
    updateMeta: () => {},
    referredFrom: () => null,
    lastNavigationCause: () => 'fresh',
    registerEntryStateCaptor: () => () => {},
    captureEntryState: () => {},
    currentEntryState: () => undefined,
    updateCurrentEntry: () => {},
  };
  const result = render(() => (
    <SplitPanel
      setPanelRef={() => {}}
      handle={handle}
      split={split}
      active
      index={0}
    />
  ));
  return { ...result, close };
}

it('shows no close button on a lone detail split', () => {
  renderDetailSplit();
  expect(screen.queryByRole('button', { name: 'Close split' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Return to list' })).toBeNull();
});

it('closes the split from the frame corner when several splits are open', () => {
  setVisibleSplits(2);
  const { close } = renderDetailSplit();

  fireEvent.click(screen.getByRole('button', { name: 'Close split' }));
  expect(close).toHaveBeenCalledOnce();
});
