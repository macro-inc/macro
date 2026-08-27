import { isListViewID, LIST_VIEW_ID } from '@app/constants/list-views';
import { useSoup } from '@app/features/next-soup/soup-context';
import { openEntityInSplitFromUnifiedList } from '@app/features/next-soup/utils';
import { CALENDAR_BLOCK_ID } from '@block-calendar/types';
import { useSidebarCollapse } from '@components/app/sidebarVisibility';
import type { BlockName } from '@core/block';
import {
  ContextMenuContent,
  MenuItem,
  MenuSeparator,
} from '@core/component/ContextMenu';
import { toast } from '@core/component/Toast/Toast';
import { fileTypeToBlockName } from '@core/constant/allBlocks';
import { TOKENS } from '@core/hotkey/tokens';
import { isMobile } from '@core/mobile/isMobile';
import { isNativeMobilePlatform } from '@core/mobile/isNativeMobilePlatform';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { type EntityDragEvent, isEntityDragEvent } from '@entity';
import { AnimatedSquareSidebarIcon } from '@icon/square-sidebar';
import SplitIcon from '@icon/wide-newSplit.svg';
import { ContextMenu } from '@kobalte/core/context-menu';
import ArrowClockwise from '@phosphor/arrow-clockwise.svg';
import ArrowLeft from '@phosphor/arrow-left.svg';
import ArrowRight from '@phosphor/arrow-right.svg';
import CollapseIcon from '@phosphor/arrows-in.svg';
import ExpandIcon from '@phosphor/arrows-out.svg';
import CaretDown from '@phosphor/caret-down.svg';
import CaretLeft from '@phosphor/caret-left.svg';
import CaretRight from '@phosphor/caret-right.svg';
import CaretUp from '@phosphor/caret-up.svg';
import CopyIcon from '@phosphor/copy.svg';
import CloseIcon from '@phosphor/x.svg';
import { mergeRefs } from '@solid-primitives/refs';
import { createDroppable, useDragDropContext } from '@thisbeyond/solid-dnd';
import { Button, cn } from '@ui';
import {
  createMemo,
  createSignal,
  type ParentProps,
  type Setter,
  Show,
  useContext,
} from 'solid-js';
import { Portal } from 'solid-js/web';
import { splitBackInterceptor } from '../back-interceptor';
import { SplitLayoutContext, SplitPanelContext } from '../context';
import type { SplitContent } from '../layoutManager';
import { shouldShowSplitCloseButton } from '../layoutUtils';
import { canSpotlight } from '../utils/canSpotlight';
import { HeaderIsland } from './HeaderIsland';
import {
  type PriorityCollapseController,
  PriorityCollapseOverflowSensor,
} from './PriorityCollapseOverflowSensor';

function getEntitySplitContent(data: EntityDragEvent['draggable']['data']):
  | {
      type: SplitContent['type'];
      id: string;
    }
  | undefined {
  if (data.type === 'document') {
    return {
      type: fileTypeToBlockName(data.subType?.type ?? data.fileType) as
        | BlockName
        | 'unknown',
      id: data.id,
    };
  }

  if (data.type === 'channel_message' || data.type === 'channel_thread') {
    return { type: 'channel', id: data.channelId };
  }

  if (data.type === 'foreign') return undefined;

  // A reminder has no block of its own — it is opened through the entity it
  // references, which the caller navigates to instead.
  if (data.type === 'reminder') return undefined;

  // Calendar events open the singleton calendar block; the full opening path
  // supplies the event range used to focus the requested occurrence.
  if (data.type === 'calendar_event')
    return { type: 'calendar', id: CALENDAR_BLOCK_ID };

  // CRM entity types map to their dedicated blocks (entity type !== block name).
  if (data.type === 'crm_company') return { type: 'company', id: data.id };
  if (data.type === 'crm_contact') return { type: 'contact', id: data.id };

  return { type: data.type, id: data.id };
}

function SplitBackButton() {
  const context = useContext(SplitPanelContext);
  if (!context) return null;
  return (
    <Button
      square
      size="sm"
      class="p-1 rounded-lg touch:active:bg-transparent"
      label="Go Back"
      hotkey={TOKENS.split.go.back}
      disabled={!context.handle.canGoBack()}
      onClick={() => {
        if (splitBackInterceptor()?.()) return;
        context.handle.goBack();
      }}
    >
      <CaretLeft />
    </Button>
  );
}

function SplitForwardButton() {
  const context = useContext(SplitPanelContext);
  if (!context) return '';
  return (
    <Button
      square
      size="sm"
      class="p-1 rounded-lg touch:active:bg-transparent"
      label="Go Forward"
      hotkey={TOKENS.split.go.forward}
      disabled={!context.handle.canGoForward()}
      onClick={context.handle.goForward}
    >
      <CaretRight />
    </Button>
  );
}

function SidebarExpandButton() {
  const panel = useContext(SplitPanelContext);
  const layout = useContext(SplitLayoutContext);
  const sidebar = useSidebarCollapse();
  const [hovering, setHovering] = createSignal(false);

  const isLeftmostSplit = () =>
    layout?.manager.splits()[0]?.id === panel?.handle.id;
  const visible = () => sidebar.isCollapsed() && isLeftmostSplit();

  return (
    <div
      class={cn(
        'overflow-hidden transition-[width,opacity,margin] duration-[120ms] ease-in-out',
        visible()
          ? 'w-8 @max-[380px]/split-header:w-0 @max-[380px]/split-header:opacity-0 opacity-100 mr-1 @max-[380px]/split-header:mr-0'
          : 'w-0 opacity-0 mr-0'
      )}
      aria-hidden={!visible()}
    >
      <Button
        class="rounded-lg"
        square
        size="sm"
        label="Expand Sidebar"
        hotkey={TOKENS.global.toggleSidebar}
        disabled={!visible()}
        tabindex={visible() ? undefined : -1}
        onClick={() => sidebar.expand()}
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => setHovering(false)}
      >
        <AnimatedSquareSidebarIcon
          class="size-4"
          triggerAnimation={hovering()}
        />
      </Button>
    </div>
  );
}

function _SplitSpotlightButton() {
  const context = useContext(SplitPanelContext);
  const layout = useContext(SplitLayoutContext);
  if (!context || !layout) return '';
  return (
    <Show when={canSpotlight(layout.manager)}>
      <Button
        class="p-1 rounded-lg hidden"
        label={
          context.handle.isSpotLight() ? 'Minimize Split' : 'Spotlight Split'
        }
        hotkey={TOKENS.window.spotlight.toggle}
        onClick={() => context.handle.toggleSpotlight()}
      >
        {context.handle.isSpotLight() ? (
          <CollapseIcon class="h-4" />
        ) : (
          <ExpandIcon class="h-4" />
        )}
      </Button>
    </Show>
  );
}

function SplitCloseButton() {
  const context = useContext(SplitPanelContext);
  const layout = useContext(SplitLayoutContext);
  if (!context || !layout) return null;

  const label = createMemo(() => {
    const isOnlySplit = layout.manager.splits().length === 1;
    const isNotUnifiedList = !isListViewID(context.handle.content().id);
    return isOnlySplit && isNotUnifiedList ? 'Return to list' : 'Close';
  });

  return (
    <Show when={shouldShowSplitCloseButton(layout.manager, context.handle)}>
      <Button
        square
        size="sm"
        class="rounded-lg"
        label={label()}
        hotkey={TOKENS.split.close}
        onClick={context.handle.close}
      >
        <CloseIcon />
      </Button>
    </Show>
  );
}

function SoupNavigationButtons() {
  const context = useContext(SplitPanelContext);
  const soup = useSoup();
  if (!context) return null;

  const rows = createMemo(() => soup.rows());
  const currentIndex = () => soup.focus.index();

  const navigationReferredFrom = createMemo(() => {
    const referredFrom = context.handle.referredFrom();
    if (referredFrom !== 'inbox' && referredFrom !== 'mail') {
      return;
    }

    return referredFrom;
  });

  const shouldShow = createMemo(() => {
    // The mobile swipe layout doesn't handle mergeHistory navigations, so
    // these controls would silently no-op there.
    if (isTouchDevice()) return false;

    const referredFrom = navigationReferredFrom();
    const isNavigableListView =
      referredFrom === 'inbox' || referredFrom === 'mail';

    return isNavigableListView && rows().length > 0;
  });

  const canNavigateUp = createMemo(() => {
    return rows().length > 0 && currentIndex() !== 0;
  });

  const canNavigateDown = createMemo(() => {
    return rows().length > 0 && currentIndex() !== rows().length - 1;
  });

  const navigate = (offset: number) => {
    const next = soup.navigate.by(offset, { skipGroupHeaders: true });
    if (!next) return;

    void openEntityInSplitFromUnifiedList(next.row.original, {
      splitHandle: context.handle,
      mergeHistory: true,
      referredFrom: navigationReferredFrom(),
    });
  };

  return (
    <Show when={shouldShow()}>
      <div class="flex items-center gap-0.5">
        <Button
          class="p-1 rounded-lg"
          label="Previous item"
          hotkey={TOKENS.entity.step.start}
          disabled={!canNavigateUp()}
          onClick={() => navigate(-1)}
        >
          <CaretUp class="size-4" />
        </Button>
        <Button
          class="p-1 rounded-lg"
          label="Next item"
          hotkey={TOKENS.entity.step.end}
          disabled={!canNavigateDown()}
          onClick={() => navigate(1)}
        >
          <CaretDown class="size-4" />
        </Button>
      </div>
    </Show>
  );
}

function SplitHeaderContextMenu(props: ParentProps) {
  const panel = useContext(SplitPanelContext);
  const layout = useContext(SplitLayoutContext);
  if (!panel || !layout) return props.children;

  const splitIndex = createMemo(() =>
    layout.manager.splits().findIndex((split) => split.id === panel.handle.id)
  );
  const hasOtherSplits = createMemo(() => layout.manager.splits().length > 1);
  const canDuplicateSplit = createMemo(
    () => panel.handle.content().type === 'component'
  );
  const canToggleSpotlight = createMemo(() => canSpotlight(layout.manager));
  const canSwapWith = (direction: 'left' | 'right') =>
    layout.manager.canSwapSplit(panel.handle.id, direction);

  const newSplitContent = () => ({
    type: 'component' as const,
    id: LIST_VIEW_ID.inbox,
  });

  const duplicateContent = (): SplitContent => ({ ...panel.handle.content() });

  const insertSplitBeside = (side: 'left' | 'right', content: SplitContent) => {
    const index = splitIndex();
    if (index < 0) return;

    const insertIndex = side === 'left' ? index : index + 1;

    layout.manager.createNewSplit({
      content,
      activate: true,
      allowDuplicate: true,
      insertIndex,
      referredFrom: null,
    });
  };

  const copyDebugInfo = async () => {
    try {
      const splits = layout.manager.splits();
      await navigator.clipboard.writeText(
        JSON.stringify(
          {
            activeSplitId: layout.manager.activeSplitId(),
            currentSplitId: panel.handle.id,
            currentSplitIndex: splitIndex(),
            currentSplitUrl: panel.handle.getUrl(),
            splits: splits.map((split, index) => ({
              index,
              id: split.id,
              content: split.content,
              referredFrom: split.referredFrom,
              isCurrent: split.id === panel.handle.id,
            })),
          },
          null,
          2
        )
      );
      toast.success('Debug info copied to clipboard');
    } catch (error) {
      console.error('Failed to copy split debug info', error);
      toast.failure('Failed to copy debug info');
    }
  };

  return (
    <ContextMenu>
      <ContextMenu.Trigger class="contents">
        {props.children}
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenuContent class="w-60">
          <MenuItem
            icon={SplitIcon}
            iconClass="rotate-180"
            text="New split left"
            disabled={!layout.manager.canAppendSplit()}
            onClick={() => insertSplitBeside('left', newSplitContent())}
          />
          <MenuItem
            icon={SplitIcon}
            text="New split right"
            disabled={!layout.manager.canAppendSplit()}
            onClick={() => insertSplitBeside('right', newSplitContent())}
          />
          <MenuItem
            icon={CopyIcon}
            text="Duplicate split"
            disabled={!layout.manager.canAppendSplit() || !canDuplicateSplit()}
            onClick={() => insertSplitBeside('right', duplicateContent())}
          />
          <MenuSeparator />
          <MenuItem
            icon={ArrowLeft}
            text="Swap split left"
            disabled={!canSwapWith('left')}
            onClick={() => layout.manager.swapSplit(panel.handle.id, 'left')}
          />
          <MenuItem
            icon={ArrowRight}
            text="Swap split right"
            disabled={!canSwapWith('right')}
            onClick={() => layout.manager.swapSplit(panel.handle.id, 'right')}
          />
          <MenuSeparator />
          <MenuItem
            icon={panel.handle.isSpotLight() ? CollapseIcon : ExpandIcon}
            hotkeyToken={TOKENS.window.spotlight.toggle}
            text={
              panel.handle.isSpotLight() ? 'Minimize split' : 'Spotlight split'
            }
            disabled={!canToggleSpotlight()}
            onClick={() => panel.handle.toggleSpotlight()}
          />
          <MenuSeparator />
          <MenuItem
            icon={CloseIcon}
            text="Close other splits"
            disabled={!hasOtherSplits()}
            onClick={() => {
              const currentSplitId = panel.handle.id;
              // A Preview Pair is one unit: keep the current split's partner so
              // closing "other" splits from a Viewer doesn't strand it by
              // removing its Controller (or vice versa).
              const partnerId =
                layout.manager.controllerOf(currentSplitId) ??
                layout.manager.viewerOf(currentSplitId);
              const kept = new Set([currentSplitId, partnerId]);

              const otherSplitIds = layout.manager
                .splits()
                .map((split) => split.id)
                .filter((id) => !kept.has(id));

              for (const splitId of otherSplitIds) {
                layout.manager.removeSplit(splitId);
              }

              layout.manager.activateSplit(currentSplitId);
            }}
          />
          <MenuItem
            icon={ArrowClockwise}
            text="Reset sizes"
            disabled={!hasOtherSplits()}
            onClick={() => layout.manager.resizeContext()?.reset()}
          />
          <MenuSeparator />
          <MenuItem
            icon={CopyIcon}
            text="Copy debug info"
            onClick={copyDebugInfo}
          />
        </ContextMenuContent>
      </ContextMenu.Portal>
    </ContextMenu>
  );
}

export function SplitHeader(props: {
  ref: Setter<HTMLDivElement | null>;
  collapseController: PriorityCollapseController;
}) {
  const panel = useContext(SplitPanelContext);
  if (!panel) {
    throw new Error('<SplitHeader> must be used within a <SplitLayout>');
  }

  const droppableId = `split-header-${panel.handle.id}`;
  const droppable = createDroppable(droppableId, {
    type: 'split-header',
  });
  const [dragDropState, { onDragEnd }] = useDragDropContext() ?? [
    undefined,
    { onDragEnd: () => {} },
  ];

  const isEntityDraggingOver = createMemo(() => {
    const data = dragDropState?.active.draggable?.data;
    return (
      data?.dragType === 'entity' &&
      dragDropState?.active.droppable?.id === droppableId
    );
  });

  onDragEnd((event) => {
    if (!isEntityDragEvent(event) || event.droppable?.id !== droppableId) {
      return;
    }

    const data = event.draggable.data;

    const current = panel.handle.content();
    const next = getEntitySplitContent(data);
    if (!next) return;
    if (current.type === next.type && current.id === next.id) return;

    void openEntityInSplitFromUnifiedList(data, {
      splitHandle: panel.handle,
      allowDuplicate: true,
    });
  });

  return (
    <SplitHeaderContextMenu>
      <div
        class={cn(
          '@container/split-header isolate relative w-full h-full overflow-clip text-ink',
          // On mobile the header overlays the panel body as a transparent strip
          // of floating islands; the island utility's px min-size keeps them
          // tappable regardless of the OS text-size setting (inert on desktop).
          'touch:absolute touch:inset-x-0 touch:top-(--safe-top) touch:z-mobile-nav-bar touch:h-11.25 touch:overflow-visible touch:pointer-events-none',
          isMobile() &&
            !isNativeMobilePlatform() &&
            'touch:top-[calc(var(--safe-top)+6px)]',
          isEntityDraggingOver() && 'bg-active'
        )}
        data-split-header
        ref={mergeRefs(droppable, props.ref)}
      >
        <Show when={panel.panelRef()}>
          {(panelRef) => (
            <Portal mount={panelRef()}>
              <Show when={isEntityDraggingOver()}>
                <div
                  class="pointer-events-none absolute inset-0 rounded-xl z-modal-overlay bg-modal-overlay pattern-diagonal-4 pattern-edge-muted flex items-center justify-center"
                  data-split-header-drop-overlay
                >
                  <div class="max-w-[min(28rem,calc(100%-3rem))] min-w-0 bg-surface border border-edge rounded-lg shadow-lg shadow-drop-shadow px-4 py-3 flex items-center gap-2 text-sm text-ink">
                    <span class="shrink-0 text-ink-muted">
                      Open in this split
                    </span>
                  </div>
                </div>
              </Show>
            </Portal>
          )}
        </Show>
        <div
          class="absolute inset-0 flex justify-start items-center touch:px-(--mobile-chrome-gutter) touch:gap-2"
          ref={props.collapseController.setRow}
        >
          <Show
            when={isTouchDevice()}
            fallback={
              <div class="relative flex items-center pl-2 h-full">
                <SidebarExpandButton />
                <SplitCloseButton />
                <div class="flex items-center @max-[380px]/split-header:hidden">
                  <SplitBackButton />
                  <SplitForwardButton />
                </div>
              </div>
            }
          >
            {/* Back/forward island. List views never render the back button
                (their header hosts the filter pills instead), so the island
                hides for them even when history allows going back. */}
            <HeaderIsland
              class={cn(
                'relative gap-0 px-1',
                (!panel.handle.canGoBack() ||
                  isListViewID(panel.handle.content().id)) &&
                  'hidden'
              )}
            >
              <Show when={!isListViewID(panel.handle.content().id)}>
                <SplitBackButton />
              </Show>
            </HeaderIsland>
          </Show>

          {/* On mobile nothing clips this region (islands float over the
              panel), so the max-content element is capped at the sensor's
              width to let shrinkable islands truncate long titles instead of
              painting off-screen. */}
          <PriorityCollapseOverflowSensor
            controller={props.collapseController}
            truncateAsLastResort
            class="relative min-w-0 h-full shrink overflow-hidden touch:overflow-visible"
            contentClass="h-full flex items-center gap-0.5 pl-2 touch:pl-0 touch:gap-2 touch:max-w-full"
            contentRef={(element) => {
              panel.layoutRefs.headerLeft = element;
            }}
          />

          <div class="h-full grow shrink flex items-center justify-end gap-0.5 px-2 touch:px-0 touch:gap-2">
            <div
              class="contents"
              ref={(ref) => {
                panel.layoutRefs.headerRight = ref;
              }}
            />
            <SoupNavigationButtons />
          </div>
        </div>
      </div>
    </SplitHeaderContextMenu>
  );
}

export function SplitHeaderLeft(props: ParentProps) {
  const ctx = useContext(SplitPanelContext);
  if (!ctx)
    throw new Error('<SplitHeaderLeft> must be used within a <SplitLayout>');

  return (
    <Show when={ctx.layoutRefs.headerLeft}>
      <Portal
        mount={ctx.layoutRefs.headerLeft}
        ref={(div) => (div.style.display = 'contents')}
      >
        {props.children}
      </Portal>
    </Show>
  );
}

export function SplitHeaderRight(props: ParentProps) {
  const ctx = useContext(SplitPanelContext);
  if (!ctx)
    throw new Error('<SplitHeaderRight> must be used within a <SplitLayout>');

  return (
    <Show when={ctx.layoutRefs.headerRight}>
      <Portal
        mount={ctx.layoutRefs.headerRight}
        ref={(div) => (div.style.display = 'contents')}
      >
        {props.children}
      </Portal>
    </Show>
  );
}
