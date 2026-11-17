import { isDayDraftRangeBinding } from '@app/features/calendar/context/day-draft-range-context';
import { SoupContextProvider } from '@app/features/next-soup/soup-context';
import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import { useHotkeyDOMScope } from '@core/hotkey/hotkeys';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { cn, Dialog, Panel } from '@ui';
import {
  createMemo,
  createSignal,
  For,
  onCleanup,
  Show,
  Suspense,
} from 'solid-js';
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
import { focusPopoverInput } from '../utils/focusPopoverInput';

false;

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
        <Suspense>
          <PopoverSplitModal
            popover={popover}
            onClose={() => props.onClosePopover?.(popover.id)}
          />
        </Suspense>
      )}
    </For>
  );
}

function PopoverSplitModal(props: {
  popover: PopoverSplitData;
  onClose: () => void;
}) {
  const draftParam =
    props.popover.content.type === 'component'
      ? props.popover.content.params?.dayDraftRange
      : undefined;
  const dayDraft = isDayDraftRangeBinding(draftParam) ? draftParam : undefined;
  const [panelRef, setPanelRef] = createSignal<HTMLElement | null>(null);
  const [displayName, setDisplayName] = createSignal(props.popover.content.id);
  const [contentOffsetTop, setContentOffsetTop] = createSignal(0);
  const [drawerHeader, setDrawerHeader] = createSignal<HTMLElement>();
  const [drawerFooter, setDrawerFooter] = createSignal<HTMLElement>();
  const [drawerScrollBody, setDrawerScrollBody] = createSignal<HTMLElement>();
  const [drawerHeightRequests, setDrawerHeightRequests] = createSignal<
    { height: number; opaque?: boolean }[]
  >([]);
  const drawerTargetHeight = () => drawerHeightRequests().at(-1)?.height;
  const fillDrawer = (requestedHeight = 70, options?: { opaque?: boolean }) => {
    // The latest live owner wins; disposing either owner only removes its request.
    const request = { height: requestedHeight, opaque: options?.opaque };
    setDrawerHeightRequests((requests) => [...requests, request]);
    onCleanup(() =>
      setDrawerHeightRequests((requests) =>
        requests.filter((current) => current !== request)
      )
    );
  };
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
    replace: () => {},
    // A popover has no history to rewrite.
    adoptContentId: () => {},
    updateCurrentEntry: () => {},
    removeFromHistory: () => {},
    registerContentChangeListener: () => {},
    unregisterContentChangeListener: () => {},
    previousContent: () => null,
    history: () => [],
    meta: () =>
      props.popover.mount.kind === 'component'
        ? props.popover.mount.meta
        : undefined,
    updateMeta:
      props.popover.mount.kind === 'component'
        ? props.popover.mount.updateMeta
        : undefined,
    referredFrom: () => null,
    lastNavigationSource: () => null,
    lastNavigationCause: () => 'fresh',
    registerEntryStateCaptor: () => () => {},
    captureEntryState: () => {},
    currentEntryState: () => undefined,
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
    drawerHeader,
    drawerFooter,
    drawerScrollBody,
    ...(isTouchDevice() ? { fillDrawer } : {}),
    panelSize: { width: null, height: null },
    contentOffsetTop,
    setContentOffsetTop,
    bottomPanel: () => undefined,
    registerBottomPanel: () => () => {},
    layoutRefs: {},
    mobileHeaderOwner: createSignal<symbol>(),
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
          <Panel.Body
            class={cn(
              drawerTargetHeight() != null && 'flex flex-auto flex-col'
            )}
          >
            <Suspense>
              <Dynamic component={props.popover.mount.element} />
            </Suspense>
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
          onOpenAutoFocus={(event) => focusPopoverInput(event, panelRef())}
        >
          <Panel
            hideBorder
            class="bg-transparent rounded-[inherit] *:max-h-[75vh]"
          >
            <Content />
          </Panel>
        </Dialog>
      }
    >
      <MobileDrawer
        side="bottom"
        modal={dayDraft ? false : undefined}
        closeOnOutsidePointer={dayDraft ? true : undefined}
        open={props.popover.isOpen}
        onOpenChange={onOpenChange}
        onOutsidePointer={(event) => {
          if (
            dayDraft?.interacting() ||
            (event.target instanceof Element &&
              event.target.closest('.calendar-day-draft'))
          )
            event.preventDefault();
        }}
        onInitialFocus={(event) => focusPopoverInput(event, panelRef())}
      >
        <MobileDrawer.Portal>
          <Show when={!dayDraft}>
            <MobileDrawer.Overlay />
          </Show>
          <MobileDrawer.Content
            ref={attachPanel}
            aria-label={displayName()}
            maxHeight={92}
            opaque={drawerHeightRequests().at(-1)?.opaque}
            class="[&:has(>[data-drawer-footer]:not(:empty))>[data-drawer-scroll-body]]:pb-0"
            // Room to write a few paragraphs without covering the page.
            targetHeight={drawerTargetHeight()}
          >
            <MobileDrawer.Handle />
            {/* Before the scroll body so it exists when the content mounts;
                hidden unless the content portals its pinned actions here. */}
            <div ref={setDrawerHeader} class="shrink-0 empty:hidden" />
            <MobileDrawer.ScrollBody ref={setDrawerScrollBody}>
              {/* As in Dialog's drawer: at its natural height the body's
                  overflow-clip cannot clip the drawer's scroll body. Filling
                  content grows past it but never shrinks below it, so a
                  sheet the keyboard shortens still scrolls. */}
              <div
                class={
                  drawerTargetHeight() != null
                    ? 'flex flex-auto flex-col'
                    : 'shrink-0'
                }
              >
                <Content />
              </div>
            </MobileDrawer.ScrollBody>
            <div
              ref={setDrawerFooter}
              data-drawer-footer
              class="shrink-0 empty:hidden"
            />
          </MobileDrawer.Content>
        </MobileDrawer.Portal>
      </MobileDrawer>
    </Show>
  );
}
