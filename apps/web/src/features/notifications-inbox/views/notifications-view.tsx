import {
  createListController,
  useListInteractions,
} from '@app/components/list';
import {
  useViewControlHotkeys,
  ViewBreadcrumbs,
  ViewShell,
  ViewSidebar,
} from '@app/components/view-shell';
import { ListSkeleton } from '@app/components/view-shell/ListSkeleton';
import { createPreviewSelectionGuard } from '@components/app/createPreviewSelectionGuard';
import { useGlobalBlockOrchestrator } from '@components/app/GlobalAppState';
import { MobileTopEdgeFade } from '@components/app/mobile/MobileEdgeFade';
import { PullToRefresh } from '@components/app/mobile/PullToRefresh';
import {
  SwipableRow,
  SwipableRowProvider,
} from '@components/app/mobile/SwipableRow';
import { PreviewPanel } from '@components/app/PreviewPanel';
import {
  type PreviewPanelSelection,
  previewBlockTarget,
} from '@components/app/previewTarget';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { SplitPanel } from '@components/app/split-panel';
import { toast } from '@core/component/Toast/Toast';
import { registerHotkey } from '@core/hotkey/hotkeys';
import { TOKENS } from '@core/hotkey/tokens';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { fireAndForget } from '@core/util/fireAndForget';
import type { EntityData } from '@entity';
import { formatTimestamp } from '@entity/utils/timestamp';
import ArrowCounterClockwise from '@phosphor/arrow-counter-clockwise.svg';
import BellIcon from '@phosphor/bell.svg';
import CheckIcon from '@phosphor/check.svg';
import GearSixIcon from '@phosphor/gear-six.svg';
import { useMutationUndoContext } from '@queries/undo';
import { createElementSize } from '@solid-primitives/resize-observer';
import { debounce } from '@solid-primitives/scheduled';
import { Button, EmptyStatePanel } from '@ui';
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  type JSX,
  Match,
  onCleanup,
  onMount,
  Show,
  Suspense,
  Switch,
} from 'solid-js';
import { match } from 'ts-pattern';
import { Virtualizer, type VirtualizerHandle } from 'virtua/solid';
import { InboxFilterDrawer } from '../components/inbox-filter-drawer';
import { InboxFilterMenu } from '../components/inbox-filter-menu';
import { NotificationRow } from '../components/notification-row';
import { RowActionButtons } from '../components/row-action-buttons';
import {
  type NotificationInboxRow,
  useNotificationsInboxContext,
} from '../context/notifications-inbox-context';
import { statusIncludes } from '../core/inbox-filters';
import type { InboxDecision } from '../core/inbox-row';
import { describeInboxRow } from '../primitives/describe-row';
import { createInboxFilters } from '../primitives/inbox-filters';
import { createInboxList } from '../primitives/inbox-list';
import { createInboxSelection } from '../primitives/inbox-selection';
import { createRowActions, rowButtons } from '../primitives/row-actions';

type ActivationMetadata = { event?: MouseEvent; newSplit?: boolean };

export type NotificationsViewProps = {
  /** Open what a row is about; the host decides where. */
  onOpen: (row: NotificationInboxRow, options: { newSplit: boolean }) => void;
  /** Open the settings that decide which notifications are delivered. */
  onOpenSettings: () => void;
};

/** Distance from the end of the list, in pixels, that loads the next page. */
const LOAD_MORE_DISTANCE_PX = 300;

const decisionOutcome = (decision: InboxDecision) =>
  match(decision)
    .with('approve', () => 'Access granted')
    .with('deny', () => 'Access request denied')
    .with('accept', () => 'Added to the event')
    .with('decline', () => 'Join request declined')
    .exhaustive();

const decisionFailure = (decision: InboxDecision) =>
  match(decision)
    .with('approve', 'deny', () => 'Couldn’t answer the access request')
    .with('accept', 'decline', () => 'Couldn’t answer the join request')
    .exhaustive();

/**
 * What the preview pane can show inline; calendar events and projects open
 * in their own views instead.
 */
const previewSelection = (
  entity: EntityData
): PreviewPanelSelection | undefined =>
  entity.type === 'calendar_event' || entity.type === 'initiative'
    ? undefined
    : entity;

function NotificationsBreadcrumb(props: { onReturn: () => void }) {
  return (
    <nav aria-label="Notifications location" class="flex items-center gap-0.5">
      <ViewBreadcrumbs.ReturnButton
        data-allow-focus-in-preview
        onClick={props.onReturn}
      >
        Notifications
      </ViewBreadcrumbs.ReturnButton>
      <ViewBreadcrumbs.Separator />
    </nav>
  );
}

function ListHeader(props: { actions: JSX.Element }) {
  return (
    <header class="flex shrink-0 flex-col">
      <ViewSidebar.Header>
        <div class="flex min-w-0 flex-1 items-center gap-1">
          <ViewSidebar.CloseButton class="shrink-0" />
          <ViewSidebar.Title>Notifications</ViewSidebar.Title>
          <div class="ml-auto flex shrink-0 items-center gap-1">
            {props.actions}
          </div>
        </div>
      </ViewSidebar.Header>
    </header>
  );
}

function ListStatus(props: { children: JSX.Element }) {
  return (
    <div class="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-4 text-center text-sm text-ink-muted touch:pt-(--mobile-content-inset-top)">
      {props.children}
    </div>
  );
}

/**
 * The unified notifications list beside a preview of the chosen row: one row
 * per thing that needs the viewer, newest first. `j`/`k` move (and follow in
 * an open preview), Enter previews, `e` marks the focused row done. Touch
 * shows the list alone: a tap opens the row in place, a left swipe marks it
 * done, and pulling down refreshes.
 */
export function NotificationsView(props: NotificationsViewProps) {
  const panel = useSplitPanelOrThrow();
  const context = useNotificationsInboxContext();
  const { pushUndo } = useMutationUndoContext();
  const filters = createInboxFilters(context.filterStorage);
  const feed = context.createFeed(() => ({ rowTypes: filters.rowTypes() }));
  const inbox = createInboxList(
    feed,
    {
      pushUndo: (entry) => pushUndo(entry),
      announceDone: (count, undo) => {
        const id = toast.success(
          count > 1
            ? `Marked ${count} notifications as done`
            : 'Marked as done',
          {
            actions: [
              {
                label: 'Undo',
                icon: ArrowCounterClockwise,
                onClick: () => fireAndForget(undo(), 'notifications-inbox'),
              },
            ],
            duration: 3_000,
            stack: true,
            hideOnMobile: true,
          }
        );
        return () => {
          if (id !== undefined) toast.dismiss(id);
        };
      },
      announceFailure: (message) => toast.failure(message),
    },
    (row) => statusIncludes(filters.filters().status, row.unseen)
  );

  onMount(() => panel.handle.setDisplayName('Notifications'));

  const [filterOpen, setFilterOpen] = createSignal(false);
  useViewControlHotkeys({
    scopeId: panel.splitHotkeyScope,
    enabled: panel.isPanelActive,
    filter: {
      description: 'Filter notifications',
      run: () => {
        setFilterOpen(true);
      },
    },
  });

  const view = createMemo(inbox.view);
  const rows = (): readonly NotificationInboxRow[] => {
    const current = view();
    return current.t === 'ready' ? current.rows : [];
  };

  const orchestrator = useGlobalBlockOrchestrator();
  const guard = createPreviewSelectionGuard();
  const selection = createInboxSelection(rows);
  const previewTarget = createMemo(() => {
    const row = selection.selected();
    const entity = row && previewSelection(row.content.entity);
    return entity && previewBlockTarget(entity);
  });

  const markSeen = (row: NotificationInboxRow) => {
    if (!row.unseen) return;
    fireAndForget(feed.markSeen([row]), 'notifications-inbox');
  };

  /** Show a row in the preview, or open it when it has no inline preview. */
  const preview = (row: NotificationInboxRow) => {
    const entity = previewSelection(row.content.entity);
    if (!entity) {
      props.onOpen(row, { newSplit: false });
      return;
    }
    const target = previewBlockTarget(entity);
    if (!guard.canSelect(target)) return;
    selection.select(row);
    guard(target);
    markSeen(row);
  };
  const previewAfterMove = debounce(preview, 150);
  onCleanup(() => previewAfterMove.clear());

  const list = createListController<NotificationInboxRow, ActivationMetadata>({
    items: rows,
    getKey: (row) => row.id,
    onActivate: ({ item, metadata }) => {
      previewAfterMove.clear();
      // Phones show one pane: open in place.
      if (isTouchDevice()) {
        markSeen(item);
        props.onOpen(item, { newSplit: false });
        return;
      }
      if (metadata?.newSplit === true || metadata?.event?.shiftKey === true) {
        markSeen(item);
        props.onOpen(item, { newSplit: true });
        return;
      }
      preview(item);
    },
  });

  const rowActions = createRowActions({
    requests: context.requests,
    open: (row) => list.activate.key(row.id, { reason: 'pointer' }),
    review: (row, url) => {
      context.openUrl(url);
      markSeen(row);
    },
    complete: (row) => {
      const next = selection.afterLeaving([row.id]);
      if (next === 'none') selection.clear();
      else if (next !== 'stay') preview(next);
      return feed.markDone([row]);
    },
    notices: {
      succeeded: (decision) => toast.success(decisionOutcome(decision)),
      failed: (decision) => toast.failure(decisionFailure(decision)),
    },
  });

  const markDone = (done: readonly NotificationInboxRow[]) => {
    const next = selection.afterLeaving(done.map((row) => row.id));
    if (next === 'none') selection.clear();
    else if (next !== 'stay') preview(next);
    fireAndForget(inbox.markDone(done), 'notifications-inbox');
  };

  const [viewport, setViewport] = createSignal<HTMLDivElement>();
  const [virtualizer, setVirtualizer] = createSignal<VirtualizerHandle>();
  const viewportSize = createElementSize(viewport);
  const [topSpacer, setTopSpacer] = createSignal<HTMLDivElement>();
  const topSpacerSize = createElementSize(topSpacer);
  const [listFrame, setListFrame] = createSignal<HTMLDivElement>();

  const loadMore = () => fireAndForget(inbox.loadMore(), 'notifications-inbox');

  useListInteractions({
    controller: list,
    scopeId: panel.splitHotkeyScope,
    enabled: panel.isPanelActive,
    scrollHandle: virtualizer,
    navigation: {
      onNavigate: (event) => {
        // An open preview follows the keyboard.
        if (event.result && selection.selected()) {
          previewAfterMove(event.result.item);
        }
        if (event.kind !== 'move' || event.direction !== 1) return;
        if (!event.result || list.items.count() - event.result.index <= 4) {
          loadMore();
        }
      },
    },
    activation: {
      createMetadata: (intent) => ({ newSplit: intent === 'alternate' }),
      alternateDescription: 'Open in new split',
    },
  });

  registerHotkey({
    hotkey: ['e'],
    hotkeyToken: TOKENS.entity.action.markDone,
    scopeId: panel.splitHotkeyScope,
    description: 'Mark done',
    condition: () => panel.isPanelActive() && list.focus.item() !== undefined,
    keyDownHandler: (event) => {
      if (event?.repeat) return true;
      const row = list.focus.item();
      if (!row) return false;
      markDone([row]);
      return true;
    },
  });

  // Keep paging while the loaded rows don't fill the viewport, including a
  // page whose rows all wait for the next one.
  const checkNearEnd = () => {
    const current = view();
    if (current.t !== 'ready' || !current.hasMore || current.loadingMore) {
      return;
    }
    const container = viewport();
    if (!container || container.clientHeight === 0) {
      if (current.rows.length === 0) loadMore();
      return;
    }
    const distance =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    if (distance < LOAD_MORE_DISTANCE_PX) loadMore();
  };
  createEffect(() => {
    view();
    viewportSize.height;
    const frame = requestAnimationFrame(checkNearEnd);
    onCleanup(() => cancelAnimationFrame(frame));
  });

  const display = (row: NotificationInboxRow) => describeInboxRow(row, context);

  /** On touch, a left swipe marks the row done. */
  const SwipeToDone = (swipe: {
    row: NotificationInboxRow;
    children: JSX.Element;
  }) => (
    <Show when={isTouchDevice()} fallback={swipe.children}>
      <SwipableRow
        id={swipe.row.id}
        swipeLeftColor="bg-success"
        swipeLeftRevealedComponent={<CheckIcon class="size-8 text-surface" />}
      >
        {swipe.children}
      </SwipableRow>
    </Show>
  );

  const listBody = () => (
    <Switch>
      <Match when={!filters.showsNothing() && view().t === 'loading'}>
        <ListSkeleton.Root
          label="Loading notifications"
          class="px-(--sidebar-gutter) pt-2 touch:pt-(--mobile-content-inset-top)"
        >
          <For each={[0, 1, 2, 3, 4]}>
            {() => (
              <ListSkeleton.Row class="h-16 flex-col items-start justify-center gap-2">
                <ListSkeleton.Bar class="w-1/2" />
                <ListSkeleton.Bar class="w-4/5" />
              </ListSkeleton.Row>
            )}
          </For>
        </ListSkeleton.Root>
      </Match>
      <Match when={view().t === 'error'}>
        <ListStatus>
          <span>Notifications couldn’t be loaded.</span>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              fireAndForget(inbox.refresh(), 'notifications-inbox')
            }
          >
            Try again
          </Button>
        </ListStatus>
      </Match>
      <Match when={filters.showsNothing()}>
        <ListStatus>
          <span>Every kind of notification is hidden.</span>
          <Button variant="outline" size="sm" onClick={filters.reset}>
            Reset filters
          </Button>
        </ListStatus>
      </Match>
      <Match when={view().t === 'empty' && filters.activeCount() > 0}>
        <ListStatus>
          <span>No notifications match these filters.</span>
          <Button variant="outline" size="sm" onClick={filters.reset}>
            Reset filters
          </Button>
        </ListStatus>
      </Match>
      <Match when={view().t === 'empty'}>
        <div class="min-h-0 flex-1 overflow-y-auto touch:pt-(--mobile-content-inset-top)">
          <EmptyStatePanel
            graphic={BellIcon}
            title="You’re all caught up"
            description="Mentions, replies, requests, and anything else that needs you will show up here."
          />
        </div>
      </Match>
      <Match when={view().t === 'ready'}>
        <div
          ref={setViewport}
          class="scrollbar-hidden min-h-0 flex-1 overflow-y-auto overscroll-none pb-[max(0.5rem,var(--mobile-content-inset-bottom,0px))]"
          onScroll={checkNearEnd}
        >
          {/* The spacer scrolls away; the viewport stays behind the header. */}
          <div
            ref={setTopSpacer}
            aria-hidden="true"
            class="h-0 touch:h-(--mobile-content-inset-top)"
          />
          <Suspense>
            <Virtualizer
              ref={setVirtualizer}
              data={rows()}
              scrollRef={viewport()}
              startMargin={isTouchDevice() ? (topSpacerSize.height ?? 0) : 0}
              bufferSize={500}
              itemSize={64}
              keepMounted={
                list.focus.index() >= 0 ? [list.focus.index()] : undefined
              }
              onScroll={checkNearEnd}
            >
              {(row) => (
                <SwipeToDone row={row}>
                  <NotificationRow
                    id={row.id}
                    type={row.type}
                    action={display(row).action}
                    subject={display(row).subject}
                    time={formatTimestamp(new Date(row.latestAt))}
                    count={row.count}
                    unseen={row.unseen}
                    highlighted={
                      list.focus.key() === row.id ||
                      selection.selected()?.id === row.id
                    }
                    onHover={() => list.focus.set(row.id, { reason: 'hover' })}
                    onClick={(event) =>
                      list.activate.key(row.id, {
                        reason: 'pointer',
                        metadata: { event },
                      })
                    }
                    onDone={() => markDone([row])}
                    actions={
                      rowButtons(row).length > 0 ? (
                        <RowActionButtons
                          actions={rowButtons(row)}
                          pending={rowActions.pending(row.id)}
                          onChoose={(action) =>
                            fireAndForget(
                              rowActions.run(row, action),
                              'notifications-inbox'
                            )
                          }
                        />
                      ) : undefined
                    }
                  />
                </SwipeToDone>
              )}
            </Virtualizer>
          </Suspense>
        </div>
      </Match>
    </Switch>
  );

  const filterControls = {
    get status() {
      return filters.filters().status;
    },
    isShown: filters.isShown,
    get activeCount() {
      return filters.activeCount();
    },
    onStatusChange: filters.setStatus,
    onShownChange: filters.setShown,
    onReset: filters.reset,
  };

  const touchLayout = () => (
    <ViewShell.Root aside={false} main={{ min: 224 }}>
      <ViewShell.Main>
        <div
          ref={setListFrame}
          class="relative flex size-full min-h-0 min-w-0 flex-col"
          style={{
            '--mobile-content-inset-top':
              'calc(var(--safe-top, 0px) + 3.75rem)',
          }}
        >
          <header class="pointer-events-none absolute inset-x-0 top-0 z-split-panel-chrome flex shrink-0 flex-col px-(--mobile-chrome-gutter) pt-[calc(var(--safe-top,0px)+0.5rem)]">
            <div class="pointer-events-auto flex h-10 min-w-0 items-center gap-2">
              <h1 class="min-w-0 flex-1 truncate text-lg font-semibold text-ink">
                Notifications
              </h1>
              <InboxFilterDrawer {...filterControls} />
            </div>
          </header>
          <PullToRefresh
            scrollContainer={() => viewport() ?? listFrame()}
            onRefresh={inbox.refresh}
          />
          <SwipableRowProvider
            container={viewport}
            canSwipeLeft={(rowId) => rows().some((row) => row.id === rowId)}
            onSwipeLeft={(rowId) => {
              const row = rows().find((candidate) => candidate.id === rowId);
              if (row) markDone([row]);
            }}
          >
            <div
              role="grid"
              aria-label="Notifications"
              class="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
            >
              {listBody()}
            </div>
          </SwipableRowProvider>
          <MobileTopEdgeFade />
        </div>
      </ViewShell.Main>
    </ViewShell.Root>
  );

  return (
    <SplitPanel.Root>
      <SplitPanel.Body>
        <Show when={!isTouchDevice()} fallback={touchLayout()}>
          <div class="size-full min-h-0 bg-panel">
            <ViewShell.Root
              asidePreferenceKey="notifications"
              aside={{ preserveDuringResize: false }}
              main={{ preferredWidth: 640 }}
              resizable
            >
              <ViewShell.Aside class="flex flex-col bg-panel">
                <ListHeader
                  actions={
                    <>
                      <div class="relative">
                        <InboxFilterMenu
                          open={filterOpen()}
                          onOpenChange={setFilterOpen}
                          {...filterControls}
                        />
                      </div>
                      <Button
                        size="icon-md"
                        label="Notification settings"
                        onClick={() => props.onOpenSettings()}
                      >
                        <GearSixIcon />
                      </Button>
                    </>
                  }
                />
                <div
                  role="grid"
                  aria-label="Notifications"
                  aria-activedescendant={list.focus.key()}
                  tabIndex={0}
                  class="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden outline-none"
                >
                  {listBody()}
                </div>
              </ViewShell.Aside>
              <ViewShell.Main class="overflow-hidden">
                <Show
                  when={previewTarget()}
                  fallback={
                    <EmptyStatePanel
                      graphic={BellIcon}
                      title="No notification selected"
                      description="Pick a notification to see it here."
                    />
                  }
                >
                  <PreviewPanel
                    target={previewTarget()}
                    navigationRequest={selection.navigationRequest()}
                    orchestrator={orchestrator}
                    splitPanelContext={panel}
                    headerLeading={
                      <NotificationsBreadcrumb onReturn={selection.clear} />
                    }
                  />
                </Show>
              </ViewShell.Main>
            </ViewShell.Root>
          </div>
        </Show>
      </SplitPanel.Body>
    </SplitPanel.Root>
  );
}
