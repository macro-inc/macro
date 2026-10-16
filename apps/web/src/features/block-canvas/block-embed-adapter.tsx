import {
  createPriorityCollapseController,
  PriorityCollapseOverflowSensor,
} from '@components/app/split-layout/components/PriorityCollapseOverflowSensor';
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
import { useHotkeyDOMScope } from '@core/hotkey/hotkeys';
import { createBlockInstance } from '@core/orchestrator';
import {
  createEffect,
  createSignal,
  createUniqueId,
  on,
  Suspense,
  useContext,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';
import type { CanvasEmbedViewProps } from './components/embed-view';
import { CanvasAncestry } from './context/canvas-ancestry';

/** The existing app's block loader/sync boundary; graphics only stores a reference. */
export function CanvasBlockEmbed(props: CanvasEmbedViewProps) {
  const ancestors = useContext(CanvasAncestry);
  if (ancestors.includes(props.geometry.documentId) || ancestors.length >= 8)
    return (
      <div class="p-4 text-sm text-ink-muted">
        Open this canvas separately to view it.
      </div>
    );
  return <CanvasBlockEmbedContent {...props} />;
}

function CanvasBlockEmbedContent(props: CanvasEmbedViewProps) {
  const kind = props.geometry.fileType === 'canvas' ? 'canvas' : 'md';
  const documentId = props.geometry.documentId;
  // Unmanaged block-in-block instances deliberately support repeated references.
  // Legacy `nested` means a read-only thumbnail. Mount the full editor here;
  // our isolated panel and the host's inert boundary own embed interaction.
  const instance = createBlockInstance(kind, documentId);
  const [attachHotkeys, scopeId] = useHotkeyDOMScope('canvas-embed');
  const [panelRef, setPanelRef] = createSignal<HTMLElement | null>(null);
  const [displayName, setDisplayName] = createSignal(props.geometry.name);
  const [contentOffsetTop, setContentOffsetTop] = createSignal(0);
  const [titleFileMenuRef, setTitleFileMenuRef] =
    createSignal<HTMLDivElement>();
  const [titleFileMenuTrigger, setTitleFileMenuTrigger] =
    createSignal<() => void>();
  const [titleFileMenuActions, setTitleFileMenuActions] =
    createSignal<SplitFileMenuActionGroups>();
  const slots = createOwnedSlots();
  const header = createPriorityCollapseController();
  const toolbar = createPriorityCollapseController();
  const layoutRefs: SplitPanelContextType['layoutRefs'] = {};
  // A local panel handle prevents an embedded block from changing the outer
  // canvas title, navigation history, toolbar, or hotkey registrations.
  const handle: SplitHandle = {
    id: `canvas-embed-${createUniqueId()}` as SplitId,
    content: () => ({ type: kind, id: documentId }),
    close: props.onExit,
    canGoBack: () => false,
    canGoForward: () => false,
    goBack: () => {},
    goBackTo: () => false,
    goForward: () => {},
    reset: () => {},
    activate: () => {},
    isActive: () => props.active,
    isFirst: () => true,
    isLast: () => true,
    displayName,
    setDisplayName,
    toggleSpotlight: () => {},
    isSpotLight: () => false,
    isPopover: () => true,
    replace: () => {},
    adoptContentId: () => {},
    removeFromHistory: () => {},
    registerContentChangeListener: () => {},
    unregisterContentChangeListener: () => {},
    previousContent: () => null,
    history: () => [],
    meta: () => undefined,
    updateMeta: undefined,
    referredFrom: () => null,
    lastNavigationCause: () => 'fresh',
    registerEntryStateCaptor: () => () => {},
    captureEntryState: () => {},
    currentEntryState: () => undefined,
    updateCurrentEntry: () => {},
  };
  const panel: SplitPanelContextType = {
    handle,
    splitHotkeyScope: scopeId,
    isInlinePreview: true,
    isPanelActive: () => props.active,
    panelRef,
    panelSize: { width: null, height: null },
    contentOffsetTop,
    setContentOffsetTop,
    bottomPanel: () => undefined,
    registerBottomPanel: () => () => {},
    layoutRefs,
    titleFileMenuRef,
    setTitleFileMenuRef,
    titleFileMenuTrigger,
    setTitleFileMenuTrigger,
    titleFileMenuActions,
    setTitleFileMenuActions,
    replaceOwnedSlot: slots.replace,
    headerCollapser: header.collapser,
    toolbarCollapser: toolbar.collapser,
  };
  createEffect(
    on(
      () => props.active,
      (active) => {
        if (active) panelRef()?.focus({ preventScroll: true });
      }
    )
  );
  return (
    <div
      tabIndex={-1}
      class="flex size-full min-h-0 flex-col"
      ref={(element) => {
        setPanelRef(element);
        attachHotkeys(element);
      }}
    >
      <div
        ref={header.setRow}
        class="flex h-10 shrink-0 items-center border-b border-edge-muted px-2"
      >
        <PriorityCollapseOverflowSensor
          controller={header}
          truncateAsLastResort
          class="min-w-0 flex-1"
          contentClass="flex items-center gap-1"
          contentRef={(element) => {
            layoutRefs.headerLeft = element;
          }}
        />
        <div
          ref={(element) => {
            layoutRefs.headerRight = element;
          }}
          class="flex items-center"
        />
      </div>
      <div ref={toolbar.setRow} class="flex shrink-0 items-center px-2">
        <PriorityCollapseOverflowSensor
          controller={toolbar}
          class="min-w-0 flex-1"
          contentClass="flex items-center gap-1"
          contentRef={(element) => {
            layoutRefs.toolbarLeft = element;
          }}
        />
        <div
          ref={(element) => {
            layoutRefs.toolbarRight = element;
          }}
        />
      </div>
      <div class="relative min-h-0 flex-1 overflow-hidden">
        <SplitPanelContext.Provider value={panel}>
          <Suspense
            fallback={
              <div class="p-4 text-base text-ink-muted">Loading editor…</div>
            }
          >
            <Dynamic component={instance.element} />
          </Suspense>
        </SplitPanelContext.Provider>
      </div>
    </div>
  );
}
