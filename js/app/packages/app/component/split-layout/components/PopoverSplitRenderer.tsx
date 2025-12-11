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
import { SplitModal } from './SplitModal';

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
  const { popover } = props;

  // Create stub SplitPanelContext for components that expect it
  const [panelRef, setPanelRef] = createSignal<HTMLElement | null>(null);
  const [contentOffsetTop, setContentOffsetTop] = createSignal(0);
  const [previewState, setPreviewState] = createSignal(false);
  const unifiedListContext = createSoupContext();

  // Create a stub SplitHandle for the popover
  const stubHandle: SplitHandle = {
    id: popover.id as SplitId,
    close: props.onClose,
    content: () => popover.content,
    // Navigation methods (stubbed for popovers)
    canGoBack: () => false,
    canGoForward: () => false,
    goBack: () => {},
    goForward: () => {},
    reset: () => {},
    // Panel state methods
    activate: () => {},
    isActive: () => true,
    isFirst: () => true,
    isLast: () => true,
    // Display and spotlight methods
    displayName: () => popover.content.id,
    setDisplayName: () => {},
    toggleSpotlight: () => {},
    isSpotLight: () => false,
    // Content management methods
    replace: () => {},
    removeFromHistory: () => {},
    registerContentChangeListener: () => {},
    unregisterContentChangeListener: () => {},
    // URL capabilities
    getUrlSegments: () => [],
    getUrl: () => '',
    // Metadata (only for component splits)
    meta: () =>
      popover.mount.kind === 'component'
        ? (popover.mount as any).meta
        : undefined,
    updateMeta:
      popover.mount.kind === 'component'
        ? (popover.mount as any).updateMeta
        : undefined,
  };

  const stubPanelContext = {
    handle: stubHandle,
    splitHotkeyScope: `popover-${popover.id}`,
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
  };

  const getPositionClass = () => {
    const position = popover.options.style?.position ?? 'center';
    switch (position) {
      case 'top':
        return 'items-start justify-center pt-16';
      case 'bottom':
        return 'items-end justify-center pb-16';
      case 'left':
        return 'items-center justify-start pl-16';
      case 'right':
        return 'items-center justify-end pr-16';
      case 'center':
      default:
        return 'items-center justify-center';
    }
  };

  const getContentStyle = () => {
    const style = popover.options.style;
    return {
      'max-width': style?.maxWidth ?? '600px',
      'max-height': style?.maxHeight ?? '80vh',
      'z-index': props.zIndex.toString(),
    };
  };

  return (
    <SplitModal
      open={() => popover.isOpen}
      setOpen={(open) => {
        if (!open) {
          props.onClose();
        }
      }}
      mode="split"
      scrim={true}
    >
      <div
        class={`flex ${getPositionClass()} w-full h-full pointer-events-none`}
      >
        <div
          ref={setPanelRef}
          class={`pointer-events-auto bg-menu border border-edge shadow-lg ${
            popover.options.style?.className ?? ''
          }`}
          style={getContentStyle()}
        >
          <SplitPanelContext.Provider value={stubPanelContext}>
            <Show when={popover.mount}>{popover.mount.element()}</Show>
          </SplitPanelContext.Provider>
        </div>
      </div>
    </SplitModal>
  );
}
