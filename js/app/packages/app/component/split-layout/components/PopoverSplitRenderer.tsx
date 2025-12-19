import { ClippedPanel } from '@core/component/ClippedPanel';
import { DialogWrapper } from '@core/component/DialogWrapper';
import clickOutside from '@core/directive/clickOutside';
import { registerHotkey, useHotkeyDOMScope } from '@core/hotkey/hotkeys';
import { Dialog } from '@kobalte/core/dialog';
import { createMemo, createSignal, For, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { createStubSoupContext } from '../../SoupContext';
import { SplitPanelContext, type SplitPanelContextType } from '../context';
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
  const [contentOffsetTop, setContentOffsetTop] = createSignal(0);
  const [previewState, setPreviewState] = createSignal(false);

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
    isPopover: () => true,
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

  const stubPanelContext: SplitPanelContextType = {
    handle: stubHandle,
    splitHotkeyScope: `popover-${props.popover.id}`,
    isPanelActive: () => true,
    unifiedListContext: createStubSoupContext(),
    panelRef,
    panelSize: { width: null, height: null },
    contentOffsetTop,
    setContentOffsetTop,
    previewState: [previewState, setPreviewState] as [
      typeof previewState,
      typeof setPreviewState,
    ],
    layoutRefs: {},
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
      <Dialog.Overlay class="fixed inset-0 z-modal-overlay bg-transparent" />
      <div class={`fixed inset-0 z-modal flex pointer-events-none isolate`}>
        <Dialog.Content
          use:clickOutside={() => props.onClose()}
          ref={(r) => {
            bindHotKeyDom(r);
          }}
        >
          <DialogWrapper>
            <Dialog.Content>
              <ClippedPanel active tl ref={setPanelRef}>
                <SplitPanelContext.Provider value={stubPanelContext}>
                  <Show when={props.popover.mount}>
                    <Dynamic component={props.popover.mount.element} />
                  </Show>
                </SplitPanelContext.Provider>
              </ClippedPanel>
            </Dialog.Content>
          </DialogWrapper>
        </Dialog.Content>
      </div>
    </Dialog>
  );
}
