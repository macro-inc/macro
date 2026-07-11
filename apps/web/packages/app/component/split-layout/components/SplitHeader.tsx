import { useSoup } from '@app/component/next-soup/soup-context';
import { openEntityInSplitFromUnifiedList } from '@app/component/next-soup/utils';
import { useSidebarCollapse } from '@app/component/sidebarVisibility';
import { isListViewID, LIST_VIEW_ID } from '@app/constants/list-views';
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
import type { EntityDragEvent } from '@entity';
import { AnimatedSquareSidebarIcon } from '@icon/square-sidebar';
import SplitIcon from '@icon/wide-newSplit.svg';
import { ContextMenu } from '@kobalte/core/context-menu';
import ArrowClockwise from '@phosphor/arrow-clockwise.svg';
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
import { canSpotlight } from '../utils/canSpotlight';
import { HeaderIsland } from './HeaderIsland';

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
      class="p-1 rounded-lg mobile:active:bg-transparent"
      label="Go Back"
      hotkey={TOKENS.split.go.back}
      disabled={!context.handle.canGoBack()}
      onClick={() => {
        if (splitBackInterceptor()?.()) return;
        context.handle.goBack();
      }}
    >
      <CaretLeft class="h-4" />
    </Button>
  );
}

function SplitForwardButton() {
  const context = useContext(SplitPanelContext);
  if (!context) return '';
  return (
    <Button
      label="Go Forward"
      hotkey={TOKENS.split.go.forward}
      disabled={!context.handle.canGoForward()}
      onClick={context.handle.goForward}
      class={cn('p-1 rounded-lg')}
    >
      <CaretRight class="h-4" />
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
        visible() ? 'w-8 opacity-100 mr-1' : 'w-0 opacity-0 mr-0'
      )}
      aria-hidden={!visible()}
    >
      <Button
        class="p-1 rounded-lg"
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
    <Show when={layout.manager.splits().length > 1}>
      <Button
        class="p-1 rounded-lg"
        label={label()}
        hotkey={TOKENS.split.close}
        onClick={context.handle.close}
      >
        <CloseIcon class="size-4" />
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
    if (isMobile()) return false;

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
    const next = soup.navigate.by(offset);
    if (!next) return;

    void openEntityInSplitFromUnifiedList(next.row.original, {
      splitHandle: context.handle,
      mergeHistory: true,
      referredFrom: navigationReferredFrom(),
    });
  };

  return (
    <Show when={shouldShow()}>
      <div class="flex items-center gap-0.5 pl-1">
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
        <ContextMenuContent width="md">
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
            icon={panel.handle.isSpotLight() ? CollapseIcon : ExpandIcon}
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
              const otherSplitIds = layout.manager
                .splits()
                .map((split) => split.id)
                .filter((id) => id !== currentSplitId);

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

export function SplitHeader(props: { ref: Setter<HTMLDivElement | null> }) {
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

  onDragEnd((event: EntityDragEvent) => {
    if (event.droppable?.id !== droppableId) return;

    const data = event.draggable?.data;
    if (!data || data.dragType !== 'entity') return;

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
          'isolate relative w-full h-full overflow-clip text-ink',
          // On mobile the header overlays the panel body as a transparent strip
          // of floating islands
          'mobile:absolute mobile:inset-x-0 mobile:top-(--safe-top) mobile:z-mobile-nav-bar mobile:h-11.25 mobile:overflow-visible mobile:pointer-events-none',
          isMobile() && isListViewID(panel.handle.content().id) && 'hidden',
          isMobile() &&
            !isNativeMobilePlatform() &&
            'mobile:top-[calc(var(--safe-top)+6px)]',
          isEntityDraggingOver() && 'bg-active/50'
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
        <div class="absolute inset-0 flex justify-start items-center mobile:px-(--mobile-chrome-gutter) mobile:gap-2">
          <Show
            when={isMobile()}
            fallback={
              <div class="relative flex items-center pl-2 h-full">
                <SidebarExpandButton />
                <SplitCloseButton />
                <SplitBackButton />
                <SplitForwardButton />
              </div>
            }
          >
            {/* Back/forward island. */}
            <HeaderIsland
              class={cn(
                'relative gap-0 px-1',
                !panel.handle.canGoBack() && 'hidden'
              )}
            >
              <Show when={!isListViewID(panel.handle.content().id)}>
                <SplitBackButton />
              </Show>
            </HeaderIsland>
          </Show>

          <div
            class="relative min-w-0 h-full shrink pl-2 flex items-center gap-0.5 mobile:pl-0 mobile:gap-2"
            ref={(ref) => {
              panel.layoutRefs.headerLeft = ref;
            }}
          />

          <div class="h-full grow shrink flex items-center justify-end gap-0.5 px-2 mobile:px-0 mobile:gap-2">
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
