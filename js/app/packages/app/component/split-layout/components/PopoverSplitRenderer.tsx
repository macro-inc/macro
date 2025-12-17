import { ClippedPanel } from '@core/component/ClippedPanel';
import { ScopedPortal } from '@core/component/ScopedPortal';
import clickOutside from '@core/directive/clickOutside';
import { registerHotkey, useHotkeyDOMScope } from '@core/hotkey/hotkeys';
import { Dialog } from '@kobalte/core/dialog';
import { createMemo, createSignal, For, Show } from 'solid-js';
import { createSoupContext } from '../../SoupContext';
import { SplitPanelContext } from '../context';
import type {
  PopoverSplitOptions,
  SplitContent,
  SplitHandle,
  SplitId,
  SplitMount,
} from '../layoutManager';

false && clickOutside;

export type PopoverSplitData = {
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
      {(popover, index) => (
        <PopoverSplitModal
          popover={popover}
          zIndex={1000 + index() * 10}
          onClose={() => props.onClosePopover?.(popover.id)}
        />
      )}
    </For>
  );
}

function PopoverSplitModal(props: {
  popover: PopoverSplitData;
  zIndex: number;
  onClose: () => void;
}) {
  const [panelRef, setPanelRef] = createSignal<HTMLElement | null>(null);
  const [contentOffsetTop, setContentOffsetTop] = createSignal(0);
  const [previewState, setPreviewState] = createSignal(false);
  const unifiedListContext = createSoupContext();

  const stubHandle: SplitHandle = {
    id: props.popover.id as SplitId,
    close: props.onClose,
    content: () => props.popover.content,
    canGoBack: () => false,
    canGoForward: () => false,
    goBack: () => {},
    goForward: () => {},
    reset: () => {},
    activate: () => {},
    isActive: () => true,
    isFirst: () => true,
    isLast: () => true,
    displayName: () => props.popover.content.id,
    setDisplayName: () => {},
    toggleSpotlight: () => {},
    isSpotLight: () => false,
    replace: () => {},
    removeFromHistory: () => {},
    registerContentChangeListener: () => {},
    unregisterContentChangeListener: () => {},
    getUrlSegments: () => [],
    getUrl: () => '',
    meta: () =>
      props.popover.mount.kind === 'component'
        ? (props.popover.mount as any).meta
        : undefined,
    updateMeta:
      props.popover.mount.kind === 'component'
        ? (props.popover.mount as any).updateMeta
        : undefined,
  };

  const stubPanelContext = {
    handle: stubHandle,
    splitHotkeyScope: `popover-${props.popover.id}`,
    unifiedListContext,
    isPanelActive: () => true,
    panelRef,
    panelSize: { width: null, height: null },
    contentOffsetTop,
    setContentOffsetTop,
    previewState: [previewState, setPreviewState] as [
      typeof previewState,
      typeof setPreviewState,
    ],
    layoutRefs: {},
    isPopover: true,
  };

  const getPositionClass = () => {
    const position = props.popover.options.style?.position ?? 'center';
    switch (position) {
      case 'top':
        return 'items-start justify-center pt-16';
      case 'bottom':
        return 'items-end justify-center pb-16';
      case 'left':
        return 'items-center justify-start pl-16';
      case 'right':
        return 'items-center justify-end pr-16';
      default:
        return 'justify-center items-start pt-48';
    }
  };

  const [bindHotKeyDom, scopeId] = useHotkeyDOMScope(
    `popover-split-${props.popover.id}`
  );

  registerHotkey({
    hotkey: 'escape',
    scopeId,
    description: 'Close Popover',
    keyDownHandler() {
      props.onClose();
      return true;
    },
  });

  return (
    <Dialog
      open={props.popover.isOpen}
      onOpenChange={(open) => {
        if (!open) {
          props.onClose();
        }
      }}
      modal={true}
    >
      <ScopedPortal scope="global">
        <Dialog.Overlay
          class="fixed inset-0 z-modal bg-modal-overlay pattern-diagonal-4 pattern-edge-muted"
          on:click={() => props.onClose()}
        />
        <div
          class={`fixed inset-0 z-modal flex ${getPositionClass()} pointer-events-none isolate`}
        >
          <Dialog.Content
            class="w-4xl h-xl portal-scope"
            use:clickOutside={() => props.onClose()}
            ref={(r) => {
              bindHotKeyDom(r);
            }}
          >
            <ClippedPanel tl ref={setPanelRef}>
              <SplitPanelContext.Provider value={stubPanelContext}>
                <Show when={props.popover.mount}>
                  {props.popover.mount.element()}
                </Show>
              </SplitPanelContext.Provider>
            </ClippedPanel>
          </Dialog.Content>
        </div>
      </ScopedPortal>
    </Dialog>
  );
}
