import { createPriorityCollapseController } from '@app/components/priority-collapse/PriorityCollapseOverflowSensor';
import {
  type SplitFileMenuActionGroups,
  SplitPanelContext,
  type SplitPanelContextType,
} from '@components/app/split-layout/context';
import type {
  SplitHandle,
  SplitId,
} from '@components/app/split-layout/layoutManager';
import { createOwnedSlots } from '@components/app/split-layout/utils/createOwnedSlots';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { createSignal, type ParentProps, Show } from 'solid-js';
import { createMutable } from 'solid-js/store';

/** Slot host for isolated conversation interactions; production owns the split frame. */
export function ChatHeaderFixture(props: ParentProps) {
  const [panelRef, setPanelRef] = createSignal<HTMLElement | null>(null);
  const [offset, setOffset] = createSignal(0);
  const [titleRef, setTitleRef] = createSignal<HTMLDivElement>();
  const [titleTrigger, setTitleTrigger] = createSignal<() => void>();
  const [titleActions, setTitleActions] =
    createSignal<SplitFileMenuActionGroups>();
  const refs = createMutable<SplitPanelContextType['layoutRefs']>({});
  const collapse = createPriorityCollapseController();
  const slots = createOwnedSlots();
  const content = { type: 'component', id: 'external' } as const;
  const handle: SplitHandle = {
    id: 'functional-chat' as SplitId,
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
    displayName: () => 'Chat',
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
    meta: () => ({}),
    updateMeta: () => {},
    referredFrom: () => null,
    lastNavigationSource: () => null,
    lastNavigationCause: () => 'fresh',
    registerEntryStateCaptor: () => () => {},
    captureEntryState: () => {},
    currentEntryState: () => undefined,
    updateCurrentEntry: () => {},
  };

  return (
    <SplitPanelContext.Provider
      value={{
        handle,
        splitHotkeyScope: 'functional-chat',
        isPanelActive: () => true,
        panelRef,
        panelSize: { width: window.innerWidth, height: window.innerHeight },
        contentOffsetTop: offset,
        setContentOffsetTop: setOffset,
        bottomPanel: () => undefined,
        registerBottomPanel: () => () => {},
        layoutRefs: refs,
        mobileHeaderOwner: createSignal<symbol>(),
        titleFileMenuRef: titleRef,
        setTitleFileMenuRef: setTitleRef,
        titleFileMenuTrigger: titleTrigger,
        setTitleFileMenuTrigger: setTitleTrigger,
        titleFileMenuActions: titleActions,
        setTitleFileMenuActions: setTitleActions,
        replaceOwnedSlot: slots.replace,
        headerCollapser: collapse.collapser,
        toolbarCollapser: collapse.collapser,
      }}
    >
      <div
        ref={setPanelRef}
        class="relative h-full"
        style={{
          '--mobile-content-inset-top': 'calc(var(--safe-top, 0px) + 45px)',
        }}
      >
        <Show when={isTouchDevice()}>
          <div class="absolute inset-x-0 top-(--safe-top) z-mobile-nav-bar flex h-11.25 items-center gap-2 px-(--mobile-chrome-gutter)">
            <div
              class="flex min-w-0 items-center gap-2"
              ref={(element) => {
                refs.headerLeft = element;
              }}
            />
            <div
              class="ml-auto flex shrink-0 items-center gap-2"
              ref={(element) => {
                refs.headerRight = element;
              }}
            />
          </div>
        </Show>
        {props.children}
      </div>
    </SplitPanelContext.Provider>
  );
}
