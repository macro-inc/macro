import type { ListDetailNavigationTarget } from '@app/components/list';
import { ViewBreadcrumbs } from '@app/components/view-shell';
import { isListViewID, LIST_VIEW_ID } from '@app/constants/list-views';
import { CALENDAR_VIEW_ID } from '@app/features/calendar-view/types';
import { driveLocationLabel } from '@app/features/drive-view/core/location-label';
import type { DriveState } from '@app/features/drive-view/core/types';
import { useSoup } from '@app/features/next-soup/soup-context';
import { openEntityInSplitFromUnifiedList } from '@app/features/next-soup/utils';
import { projectRouteId } from '@app/features/projects/core/route';
import { useGlobalNotificationSource } from '@components/app/GlobalAppState';
import { type BlockName, NonDocumentBlockTypes } from '@core/block';
import { fileTypeToBlockName } from '@core/constant/allBlocks';
import { TOKENS } from '@core/hotkey/tokens';
import { isMobile } from '@core/mobile/isMobile';
import { isNativeMobilePlatform } from '@core/mobile/isNativeMobilePlatform';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { type EntityDragEvent, isEntityDragEvent } from '@entity';
import CollapseIcon from '@phosphor/arrows-in.svg';
import ExpandIcon from '@phosphor/arrows-out.svg';
import CaretDown from '@phosphor/caret-down.svg';
import CaretLeft from '@phosphor/caret-left.svg';
import CaretUp from '@phosphor/caret-up.svg';
import CloseIcon from '@phosphor/x.svg';
import { mergeRefs } from '@solid-primitives/refs';
import { createDroppable, useDragDropContext } from '@thisbeyond/solid-dnd';
import { Button, cn } from '@ui';
import {
  createMemo,
  type ParentProps,
  type Setter,
  Show,
  useContext,
} from 'solid-js';
import { Portal } from 'solid-js/web';
import { match, P } from 'ts-pattern';
import { splitBackInterceptor } from '../back-interceptor';
import { SplitLayoutContext, SplitPanelContext } from '../context';
import type { SplitContent } from '../layoutManager';
import {
  closeSplitOrReturnToList,
  shouldShowSplitCloseButton,
} from '../layoutUtils';
import { canSpotlight } from '../utils/canSpotlight';
import { HeaderIsland } from './HeaderIsland';
import {
  type PriorityCollapseController,
  PriorityCollapseOverflowSensor,
} from './PriorityCollapseOverflowSensor';
import { SplitHeaderContextMenu } from './SplitHeaderContextMenu';

function getEntitySplitContent(data: EntityDragEvent['draggable']['data']):
  | {
      type: SplitContent['type'];
      id: string;
    }
  | undefined {
  return (
    match(data)
      .returnType<{ type: SplitContent['type']; id: string } | undefined>()
      .with({ type: 'initiative' }, (entity) => ({
        type: 'component' as const,
        id: projectRouteId({ id: entity.id, section: 'overview' }),
      }))
      .with({ type: 'document' }, (entity) => ({
        type: fileTypeToBlockName(entity.subType?.type ?? entity.fileType) as
          | BlockName
          | 'unknown',
        id: entity.id,
      }))
      .with(
        { type: P.union('channel_message', 'channel_thread') },
        (entity) => ({
          type: 'channel',
          id: entity.channelId,
        })
      )
      .with({ type: 'agent_session' }, (entity) => ({
        type: 'agent',
        id: entity.id,
      }))
      // Reminders open their referenced entity rather than a block of their own.
      .with({ type: 'foreign' }, () => undefined)
      // The full calendar opening path supplies the event range to focus.
      .with({ type: 'calendar_event' }, () => ({
        type: 'component',
        id: CALENDAR_VIEW_ID,
      }))
      .with({ type: 'crm_company' }, (entity) => ({
        type: 'company',
        id: entity.id,
      }))
      .with({ type: 'crm_contact' }, (entity) => ({
        type: 'contact',
        id: entity.id,
      }))
      .with(
        {
          type: P.union(
            'channel',
            'chat',
            'email',
            'project',
            'call',
            'routine',
            'database',
            'form'
          ),
        },
        (entity) => ({ type: entity.type, id: entity.id })
      )
      .exhaustive()
  );
}

function hasAgentsBackFallback(content: SplitContent) {
  return (
    content.type === 'agent' || (isTouchDevice() && content.type === 'chat')
  );
}

function SplitBackButton() {
  const context = useContext(SplitPanelContext);
  if (!context) return null;
  return (
    <Button
      square
      size="sm"
      class="p-1 touch:active:bg-transparent"
      label="Go Back"
      hotkey={TOKENS.split.go.back}
      disabled={
        !context.handle.canGoBack() &&
        !hasAgentsBackFallback(context.handle.content())
      }
      onClick={() => {
        if (splitBackInterceptor()?.()) return;
        if (
          !context.handle.canGoBack() &&
          hasAgentsBackFallback(context.handle.content())
        ) {
          context.handle.replace({
            next: { type: 'component', id: 'agents' },
            mergeHistory: true,
          });
        } else context.handle.goBack();
      }}
    >
      <CaretLeft />
    </Button>
  );
}

function _SplitSpotlightButton() {
  const context = useContext(SplitPanelContext);
  const layout = useContext(SplitLayoutContext);
  if (!context || !layout) return '';
  return (
    <Show when={canSpotlight(layout.manager)}>
      <Button
        class="p-1 hidden"
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
    const isOnlySplit = !shouldShowSplitCloseButton(layout.manager);
    const isNotUnifiedList = !isListViewID(context.handle.content().id);
    return isOnlySplit && isNotUnifiedList ? 'Return to list' : 'Close';
  });

  return (
    <Show
      when={
        shouldShowSplitCloseButton(layout.manager) ||
        !isListViewID(context.handle.content().id)
      }
    >
      <Button
        square
        size="icon-sm"
        label={label()}
        hotkey={TOKENS.split.close}
        onClick={() => closeSplitOrReturnToList(layout.manager, context.handle)}
      >
        <CloseIcon class="size-4" />
      </Button>
    </Show>
  );
}

function SplitDriveReturnButton() {
  const panel = useContext(SplitPanelContext);
  const layout = useContext(SplitLayoutContext);
  if (!panel || !layout) return null;

  const sourceList = createMemo(() =>
    panel.handle
      .history()
      .slice(0, -1)
      .reverse()
      .find(
        (content) => content.type === 'component' && isListViewID(content.id)
      )
  );
  const isDrive = (content: SplitContent) =>
    content.type === 'component' && content.id === LIST_VIEW_ID.documents;
  const currentIsDriveItem = () => {
    const content = panel.handle.content();
    return (
      content.type !== 'component' &&
      (content.type === 'project' ||
        !NonDocumentBlockTypes.includes(content.type))
    );
  };
  const sourceLabel = () => {
    const state = sourceList()?.state;
    const label = state?.['drive.returnLabel'];

    if (typeof label === 'string') return label;

    const driveState = state?.['drive.view.v2'] as DriveState | undefined;
    return driveState ? driveLocationLabel(driveState.location) : 'My Files';
  };
  const returnToDrive = () => {
    if (panel.handle.goBackTo(isDrive)) return;
    const driveSplit = layout.manager
      .splits()
      .find((split) => isDrive(split.content));
    if (driveSplit) layout.manager.getSplit(driveSplit.id)?.activate();
  };

  return (
    <Show
      when={sourceList()?.id === LIST_VIEW_ID.documents && currentIsDriveItem()}
    >
      <ViewBreadcrumbs.ReturnButton
        onClick={returnToDrive}
        tooltip={sourceLabel()}
      >
        {sourceLabel()}
      </ViewBreadcrumbs.ReturnButton>
      <ViewBreadcrumbs.Separator class="ml-1" />
    </Show>
  );
}

function SoupNavigationButtons() {
  const context = useContext(SplitPanelContext);
  const soup = useSoup();
  const notificationSource = useGlobalNotificationSource();
  if (!context) return null;

  const rows = createMemo(() => soup.rows());
  const currentIndex = () => soup.focus.index();

  const navigationReferredFrom = createMemo(() => {
    const referredFrom = context.handle.referredFrom();
    if (referredFrom !== 'home' && referredFrom !== 'mail') {
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
      referredFrom === 'home' || referredFrom === 'mail';

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
      notificationSource,
    });
  };

  return (
    <Show when={shouldShow()}>
      <ListNavigationButtons
        navigation={{
          canPrevious: canNavigateUp,
          canNext: canNavigateDown,
          previous: () => navigate(-1),
          next: () => navigate(1),
        }}
      />
    </Show>
  );
}

/** Shared header controls; each host supplies its current list navigation. */
export function ListNavigationButtons(props: {
  navigation: ListDetailNavigationTarget;
  class?: string;
}) {
  return (
    <div class={cn('flex items-center gap-0.5', props.class)}>
      <Button
        size="icon-md"
        label="Previous item"
        hotkey={TOKENS.entity.step.start}
        disabled={!props.navigation.canPrevious()}
        onMouseDown={(event) => event.preventDefault()}
        onClick={props.navigation.previous}
      >
        <CaretUp class="size-4" />
      </Button>
      <Button
        size="icon-md"
        label="Next item"
        hotkey={TOKENS.entity.step.end}
        disabled={!props.navigation.canNext()}
        onMouseDown={(event) => event.preventDefault()}
        onClick={props.navigation.next}
      >
        <CaretDown class="size-4" />
      </Button>
    </div>
  );
}

export function SplitHeader(props: {
  ref: Setter<HTMLDivElement | null>;
  collapseController: PriorityCollapseController;
}) {
  const panel = useContext(SplitPanelContext);
  const notificationSource = useGlobalNotificationSource();
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
      notificationSource,
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
                  class="pointer-events-none absolute inset-0 z-modal-overlay bg-modal-overlay flex items-center justify-center"
                  data-split-header-drop-overlay
                >
                  <div class="max-w-[min(28rem,calc(100%-3rem))] min-w-0 bg-surface border border-edge rounded-full shadow-lg shadow-drop-shadow px-4 py-2 flex items-center gap-2 font-sans text-xs text-ink">
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
          class="absolute inset-0 flex justify-start items-center not-touch:pl-[5px] touch:px-(--mobile-chrome-gutter) touch:gap-2"
          ref={props.collapseController.setRow}
        >
          <Show
            when={isTouchDevice()}
            fallback={
              <div class="relative flex items-center pl-2 h-full">
                <SplitCloseButton />
                <SplitDriveReturnButton />
              </div>
            }
          >
            {/* Mobile back island. List views never render the back button
                (their header hosts the filter pills instead), so the island
                hides for them even when history allows going back. */}
            <HeaderIsland
              class={cn(
                'relative gap-0 px-1',
                ((!panel.handle.canGoBack() &&
                  !hasAgentsBackFallback(panel.handle.content())) ||
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

          <div class="header-actions h-full grow shrink flex items-center justify-end gap-1 px-2 touch:px-0 touch:gap-2">
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
