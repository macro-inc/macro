import { SoupContextProvider } from '@app/features/next-soup/soup-context';
import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import clickOutside from '@core/directive/clickOutside';
import { registerHotkey, useHotkeyDOMScope } from '@core/hotkey/hotkeys';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { Dialog, Panel } from '@ui';
import { createMemo, createSignal, For, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import {
  type SplitFileMenuActionGroups,
  SplitPanelContext,
  type SplitPanelContextType,
} from '../context';
import type {
  PopoverSplitOptions,
  SplitContent,
  SplitHandle,
  SplitId,
  SplitMount,
} from '../layoutManager';
import { createOwnedSlots } from '../utils/createOwnedSlots';

false && clickOutside;

type PopoverSplitData = {
  id: string;
  content: SplitContent;
  mount: SplitMount;
  isOpen: boolean;
  options: PopoverSplitOptions;
};

export function PopoverSplitRenderer(props: {
  popovers: () => Map<string, PopoverSplitData>;
  onClosePopover?: (id: string) => void;
}) {
  const activePopovers = createMemo(() =>
    Array.from(props.popovers().values()).filter((popover) => popover.isOpen)
  );
  return (
    <For each={activePopovers()}>
      {(popover) => (
        <PopoverSplitModal
          popover={popover}
          onClose={() => props.onClosePopover?.(popover.id)}
        />
      )}
    </For>
  );
}

function PopoverSplitModal(props: {
  popover: PopoverSplitData;
  onClose: () => void;
}) {
  const [panelRef, setPanelRef] = createSignal<HTMLElement | null>(null);
  const [displayName, setDisplayName] = createSignal(props.popover.content.id);
  const [contentOffsetTop, setContentOffsetTop] = createSignal(0);
  const [titleFileMenuRef, setTitleFileMenuRef] =
    createSignal<HTMLDivElement>();
  const [titleFileMenuTrigger, setTitleFileMenuTrigger] =
    createSignal<() => void>();
  const [titleFileMenuActions, setTitleFileMenuActions] =
    createSignal<SplitFileMenuActionGroups>();
  const ownedSlots = createOwnedSlots();

  const stubHandle: SplitHandle = {
    id: props.popover.id as SplitId,
    close: props.onClose,
    content: () => props.popover.content,
    canGoBack: () => false,
    canGoForward: () => false,
    goBack: () => {},
    goBackTo: () => false,
    goForward: () => {},
    reset: () => {},
    activate: () => {},
    isActive: () => true,
    isFirst: () => true,
    isLast: () => true,
    displayName,
    setDisplayName,
    toggleSpotlight: () => {},
    isSpotLight: () => false,
    isPopover: () => true,
    isViewerSplit: () => false,
    isControllerSplit: () => false,
    replace: () => {},
    // A popover has no URL and no history to rewrite.
    adoptContentId: () => {},
    removeFromHistory: () => {},
    registerContentChangeListener: () => {},
    unregisterContentChangeListener: () => {},
    previousContent: () => null,
    history: () => [],
    getUrlSegments: () => [],
    getUrl: () => '',
    meta: () =>
      props.popover.mount.kind === 'component'
        ? props.popover.mount.meta
        : undefined,
    updateMeta:
      props.popover.mount.kind === 'component'
        ? props.popover.mount.updateMeta
        : undefined,
    referredFrom: () => null,
    lastNavigationCause: () => 'fresh',
    registerEntryStateCaptor: () => () => {},
    captureEntryState: () => {},
    currentEntryState: () => undefined,
    canEngagePreview: () => false,
    engagePreview: () => {},
    disengagePreview: () => {},
    resetPreview: () => {},
    viewerId: () => undefined,
  };

  const [bindHotKeyDom, scopeId] = useHotkeyDOMScope(
    `popover-split-${props.popover.id}`
  );

  const stubPanelContext: SplitPanelContextType = {
    handle: stubHandle,
    // The real registered scope id: blocks register their commands to
    // `splitHotkeyScope`, so a made-up id would send them to a scope that
    // doesn't exist and every registration would silently noop.
    splitHotkeyScope: scopeId,
    isPanelActive: () => true,
    panelRef,
    panelSize: { width: null, height: null },
    contentOffsetTop,
    setContentOffsetTop,
    bottomPanel: () => undefined,
    registerBottomPanel: () => () => {},
    layoutRefs: {},
    titleFileMenuRef,
    setTitleFileMenuRef,
    titleFileMenuTrigger,
    setTitleFileMenuTrigger,
    titleFileMenuActions,
    setTitleFileMenuActions,
    replaceOwnedSlot: ownedSlots.replace,
    headerCollapser: { register: () => () => {} },
    toolbarCollapser: { register: () => () => {} },
  };

  registerHotkey({
    hotkey: 'escape',
    scopeId,
    description: 'Close Popover',
    keyDownHandler() {
      props.onClose();
      return true;
    },
  });

  const attachPanel = (element: HTMLElement) => {
    setPanelRef(element);
    bindHotKeyDom(element);
  };
  const onOpenChange = (open: boolean) => {
    if (!open) props.onClose();
  };
  const Content = () => (
    <SplitPanelContext.Provider value={stubPanelContext}>
      <SoupContextProvider>
        <Show when={props.popover.mount}>
          <Panel.Body>
            <Dynamic component={props.popover.mount.element} />
          </Panel.Body>
        </Show>
      </SoupContextProvider>
    </SplitPanelContext.Provider>
  );

  return (
    <Show
      when={isTouchDevice()}
      fallback={
        <Dialog
          open={props.popover.isOpen}
          onOpenChange={onOpenChange}
          contentRef={attachPanel}
        >
          <Panel depth={2} class="rounded-xl bg-dialog *:max-h-[75vh]">
            <Content />
          </Panel>
        </Dialog>
      }
    >
      <MobileDrawer
        side="bottom"
        open={props.popover.isOpen}
        onOpenChange={onOpenChange}
      >
        <MobileDrawer.Portal>
          <MobileDrawer.Overlay class="fixed inset-0 z-modal-overlay bg-modal-overlay" />
          <MobileDrawer.Content
            ref={attachPanel}
            class="bg-dialog"
            aria-label={displayName()}
            maxHeight={92}
          >
            <MobileDrawer.Handle />
            <MobileDrawer.ScrollBody>
              <Content />
            </MobileDrawer.ScrollBody>
          </MobileDrawer.Content>
        </MobileDrawer.Portal>
      </MobileDrawer>
    </Show>
  );
}
