import {
  createDisclosureState,
  createListController,
  useListInteractions,
} from '@app/components/list';
import {
  useViewControlHotkeys,
  useViewTabHotkeys,
  ViewShell,
  ViewSidebar,
} from '@app/components/view-shell';
import { ListSkeleton } from '@app/components/view-shell/ListSkeleton';
import type { CalendarPreviewSelection } from '@app/features/next-soup/utils';
import { t } from '@app/lib/i18n';
import { SplitRouter } from '@app/lib/split-router';
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
import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { toast } from '@core/component/Toast/Toast';
import { registerHotkey } from '@core/hotkey/hotkeys';
import { TOKENS } from '@core/hotkey/tokens';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { fireAndForget } from '@core/util/fireAndForget';
import EmptyStateInboxTrayGraphic from '@design/empty-state-inbox-tray.svg';
import type { EntityData } from '@entity';
import { formatTimestamp } from '@entity/utils/timestamp';
import ArrowCounterClockwise from '@icon/system/regular/arrow-counter-clockwise.svg';
import CheckIcon from '@icon/system/regular/check.svg';
import GearSixIcon from '@icon/system/regular/gear-six.svg';
import type { UnifiedNotification } from '@notifications/types';
import { useMutationUndoContext } from '@queries/undo';
import { createElementSize } from '@solid-primitives/resize-observer';
import { debounce } from '@solid-primitives/scheduled';
import { Button, EmptyStatePanel } from '@ui';
import {
  type Accessor,
  createComputed,
  createEffect,
  createMemo,
  createSignal,
  For,
  type JSX,
  Match,
  on,
  onCleanup,
  onMount,
  Show,
  Suspense,
  Switch,
} from 'solid-js';
import { match } from 'ts-pattern';
import { Virtualizer, type VirtualizerHandle } from 'virtua/solid';
import { InboxClearDrawer } from '../components/inbox-clear-drawer';
import { InboxClearMenu } from '../components/inbox-clear-menu';
import { InboxDateHeader } from '../components/inbox-date-header';
import { InboxFilterDrawer } from '../components/inbox-filter-drawer';
import { InboxFilterMenu } from '../components/inbox-filter-menu';
import { InboxSenderAvatar } from '../components/inbox-sender-avatar';
import {
  InboxStatusPills,
  InboxStatusTabs,
} from '../components/inbox-status-tabs';
import { NotificationRow } from '../components/notification-row';
import { NotificationStackItem } from '../components/notification-stack-item';
import { RowActionButtons } from '../components/row-action-buttons';
import { NotificationsCalendarPaneProvider } from '../context/notifications-calendar-context';
import {
  type NotificationInboxRow,
  useNotificationsInboxContext,
} from '../context/notifications-inbox-context';
import {
  clearFor,
  clearIncludes,
  type InboxClearChoice,
  type InboxStatus,
} from '../core/inbox-filters';
import type { InboxDecision } from '../core/inbox-row';
import {
  describeInboxCard,
  describeStackItem,
  inboxCardKind,
} from '../primitives/describe-row';
import {
  createInboxListItems,
  dateHeaderLabel,
  type InboxListItem,
  type InboxStackItemPlace,
  inboxSectionEnds,
  isInboxNotification,
  isInboxRow,
  isInboxStackItem,
} from '../primitives/inbox-date-headers';
import { createInboxFilters } from '../primitives/inbox-filters';
import { createInboxList } from '../primitives/inbox-list';
import {
  createInboxSelection,
  type InboxShownRow,
  type InboxShownRowLocation,
} from '../primitives/inbox-selection';
import {
  agentTurnParams,
  crmCommentParams,
} from '../primitives/notification-location';
import { createRowActions, rowButtons } from '../primitives/row-actions';
import { rowEntity } from '../primitives/row-entity';
import { NotificationsNoneSelected } from './notifications-none-selected';

type ActivationMetadata = { event?: MouseEvent; newSplit?: boolean };
/** Stepping through the list and moving on from a done row replace the entry. */
type HistoryOptions = { replace?: boolean };

export type NotificationsViewProps = {
  /** Open what a row is about, or one of its notifications; the host decides where. */
  onOpen: (
    row: NotificationInboxRow,
    options: { newSplit: boolean; notification?: UnifiedNotification }
  ) => void;
  /** Open the settings that decide which notifications are delivered. */
  onOpenSettings: () => void;
  /** Where the shown row is kept, so opening one is a history entry. */
  shownRow: InboxShownRowLocation;
  /** Calendar events show in the content area through the view's calendar route. */
  calendarPreview: {
    /**
     * Show the event in the content area, keeping the row that chose it in
     * the same history entry; false when it can't be shown there.
     */
    open: (
      entity: CalendarPreviewSelection,
      navigation: { shown: InboxShownRow; replace: boolean }
    ) => boolean;
    isOpen: Accessor<boolean>;
    /** Bumped when the shown event is chosen again. */
    refocus: Accessor<number>;
  };
};

/** Distance from the end of the list, in pixels, that loads the next page. */
const LOAD_MORE_DISTANCE_PX = 300;
const INBOX_STATUSES: readonly InboxStatus[] = ['all', 'unread'];
/** Frames a visible row is held in place after a live change above it. */
const ANCHOR_HOLD_FRAMES = 12;

const decisionOutcome = (decision: InboxDecision) =>
  match(decision)
    .with('approve', () => t('notificationsInbox.accessGranted'))
    .with('deny', () => t('notificationsInbox.accessDenied'))
    .with('accept', () => t('notificationsInbox.joinAccepted'))
    .with('decline', () => t('notificationsInbox.joinDeclined'))
    .exhaustive();

const decisionFailure = (decision: InboxDecision) =>
  match(decision)
    .with('approve', 'deny', () => t('notificationsInbox.accessAnswerFailed'))
    .with('accept', 'decline', () => t('notificationsInbox.joinAnswerFailed'))
    .exhaustive();

/**
 * What the preview pane can show inline; calendar events show through the
 * view's calendar route, and projects open in their own view.
 */
const previewSelection = (
  entity: EntityData
): PreviewPanelSelection | undefined =>
  entity.type === 'calendar_event' || entity.type === 'initiative'
    ? undefined
    : entity;

/**
 * A calendar event row as the Calendar reads it: its notifications, such as
 * a reminder naming the occurrence, behind an accessor.
 */
const calendarSelection = (
  entity: ReturnType<typeof rowEntity>
): CalendarPreviewSelection | undefined => {
  if (entity.type !== 'calendar_event') return undefined;
  const { notifications } = entity;
  return {
    ...entity,
    notifications:
      typeof notifications === 'function'
        ? notifications
        : () => notifications ?? [],
  };
};

/**
 * What the preview shows for a row or one of its notifications; undefined when
 * it has no inline preview. An agent's notification opens at its turn, and a
 * company or contact at its comment.
 */
const previewTargetFor = (
  row: NotificationInboxRow,
  notification?: UnifiedNotification
) => {
  const entity = previewSelection(rowEntity(row, notification));
  if (!entity) return undefined;
  const target = previewBlockTarget(entity);
  const params =
    (notification && agentTurnParams(notification)) ??
    crmCommentParams(notification ?? row.content.notifications[0]);
  return params ? { ...target, params } : target;
};

function ListHeader(props: { actions: JSX.Element }) {
  return (
    <header class="flex shrink-0 flex-col">
      <ViewSidebar.Header>
        <div class="flex min-w-0 flex-1 items-center gap-1">
          <ViewSidebar.CloseButton class="shrink-0" />
          <ViewSidebar.Title>{t('nav.notifications')}</ViewSidebar.Title>
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
 * per thing that needs the viewer, newest first under Home's date dividers.
 * Several notifications about one thing show as a stack; its button, or the
 * right arrow, unfolds them below the row, and each opens at its own location.
 * All and Unread switch the list, and the choice is kept between visits.
 * `j`/`k` move through rows and unfolded notifications (and follow in an open
 * preview), Enter previews, `e` marks the focused row done. Touch shows the list
 * alone: a tap opens the row or notification in place, a stack's button unfolds
 * it, a left swipe marks it done, and pulling down refreshes.
 */
export function NotificationsView(props: NotificationsViewProps) {
  const panel = useSplitPanelOrThrow();
  const context = useNotificationsInboxContext();
  const { pushUndo } = useMutationUndoContext();
  const filters = createInboxFilters(context.filterStorage);
  const feed = context.createFeed(filters.scope);
  const inbox = createInboxList(feed, {
    pushUndo: (entry) => pushUndo(entry),
    announceDone: (count, undo) => {
      const id = toast.success(t('notificationsInbox.markedDone', { count }), {
        dismissStyle: 'icon',
        actionLayout: 'inline',
        actions: [
          {
            label: t('notificationsInbox.undo'),
            icon: ArrowCounterClockwise,
            onClick: () => fireAndForget(undo(), 'notifications-inbox'),
          },
        ],
        duration: 3_000,
        stack: true,
        hideOnMobile: true,
      });
      return () => {
        if (id !== undefined) toast.dismiss(id);
      };
    },
    announceCleared: (count, undo) => {
      const id =
        count === 0
          ? toast.success(t('notificationsInbox.clearedNothing'))
          : toast.success(t('notificationsInbox.cleared', { count }), {
              dismissStyle: 'icon',
              actionLayout: 'inline',
              actions: [
                {
                  label: t('notificationsInbox.undo'),
                  icon: ArrowCounterClockwise,
                  onClick: () => fireAndForget(undo(), 'notifications-inbox'),
                },
              ],
              duration: 8_000,
              stack: true,
            });
      return () => {
        if (id !== undefined) toast.dismiss(id);
      };
    },
    announceFailure: (message) => toast.failure(message),
  });

  onMount(() => panel.handle.setDisplayName(t('nav.notifications')));

  useViewTabHotkeys({
    scopeId: panel.splitHotkeyScope,
    enabled: panel.isPanelActive,
    ids: () => INBOX_STATUSES,
    activeId: () => filters.filters().status,
    setActiveId: filters.setStatus,
  });

  const [filterOpen, setFilterOpen] = createSignal(false);
  useViewControlHotkeys({
    scopeId: panel.splitHotkeyScope,
    enabled: panel.isPanelActive,
    filter: {
      description: t('notificationsInbox.filter'),
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
  // Held by row id, not on the row: a live change replaces the row's object
  // and a stack stays open through it.
  const stacks = createDisclosureState();
  const listItems = createInboxListItems(rows, stacks.isExpanded);
  const sectionEnds = createMemo(() => inboxSectionEnds(listItems()));
  const anyStackOpen = createMemo(() =>
    rows().some((row) => row.count > 1 && stacks.isExpanded(row.id))
  );
  const rowsById = createMemo(
    () => new Map(rows().map((row) => [row.id, row] as const))
  );
  /** The row an item stands for, or the row an unfolded notification is on. */
  const rowOf = (item: InboxListItem | undefined) => {
    if (!item || !isInboxNotification(item)) return undefined;
    return rowsById().get(isInboxStackItem(item) ? item.rowId : item.id);
  };
  /** An unfolded notification's place, by its item id. */
  const stackItemOf = (id: string) =>
    listItems().find(
      (item): item is InboxStackItemPlace =>
        isInboxStackItem(item) && item.id === id
    );
  const notificationOf = (item: InboxListItem | undefined) =>
    item && isInboxStackItem(item)
      ? rowOf(item)?.content.notifications.find(
          (notification) => notification.id === item.notificationId
        )
      : undefined;

  const orchestrator = useGlobalBlockOrchestrator();
  const guard = createPreviewSelectionGuard();
  const selection = createInboxSelection(rows, props.shownRow);
  const previewTarget = createMemo(() => {
    const row = selection.selected();
    if (!row) return undefined;
    return previewTargetFor(row, selection.selectedNotification());
  });

  const markSeen = (row: NotificationInboxRow) => {
    if (!row.unseen) return;
    fireAndForget(feed.markSeen([row]), 'notifications-inbox');
  };

  /**
   * Show a row in the preview, at one of its notifications when one is named:
   * a calendar event in the Calendar, anything else in its block. A row with
   * no inline preview opens instead. Each shown row is a history entry.
   */
  const preview = (
    row: NotificationInboxRow,
    notification?: UnifiedNotification,
    history: HistoryOptions = {}
  ) => {
    const calendarEvent = calendarSelection(rowEntity(row, notification));
    if (
      calendarEvent &&
      guard.canSelect(undefined) &&
      props.calendarPreview.open(calendarEvent, {
        shown: { row: row.id, item: notification?.id ?? '' },
        replace: history.replace ?? false,
      })
    ) {
      guard(undefined);
      markSeen(row);
      return;
    }
    const target = previewTargetFor(row, notification);
    if (!target) {
      props.onOpen(row, { newSplit: false, notification });
      return;
    }
    if (!guard.canSelect(target)) return;
    selection.select(row, notification?.id, history);
    guard(target);
    markSeen(row);
  };

  // Back and forward change the shown row too; the preview claims what it
  // shows, and yields to another split that already shows it. Touch has no
  // preview to claim for.
  createEffect(
    on(
      previewTarget,
      (target, previous) => {
        if (isTouchDevice()) return;
        if (
          target?.blockType === previous?.blockType &&
          target?.blockId === previous?.blockId
        ) {
          return;
        }
        if (!guard(target)) selection.clear({ replace: true });
      },
      { defer: true }
    )
  );

  /** Leave what the content area shows for the list. */
  const closePreview = (history: HistoryOptions = {}) =>
    selection.clear(history);
  const previewAfterMove = debounce(
    (row: NotificationInboxRow, notification?: UnifiedNotification) =>
      preview(row, notification, { replace: true }),
    150
  );
  onCleanup(() => previewAfterMove.clear());

  const list = createListController<InboxListItem, ActivationMetadata>({
    items: listItems,
    getKey: (item) => item.id,
    isNavigable: isInboxNotification,
    isSelectable: isInboxRow,
    onActivate: ({ item, metadata }) => {
      const row = rowOf(item);
      if (!row) return;
      const notification = notificationOf(item);
      previewAfterMove.clear();
      // Phones show one pane: open in place.
      if (isTouchDevice()) {
        markSeen(row);
        props.onOpen(row, { newSplit: false, notification });
        return;
      }
      if (metadata?.newSplit === true || metadata?.event?.shiftKey === true) {
        markSeen(row);
        props.onOpen(row, { newSplit: true, notification });
        return;
      }
      preview(row, notification);
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
      stacks.collapse(row.id);
      const next = selection.afterLeaving([row.id]);
      if (next === 'none') closePreview({ replace: true });
      else if (next !== 'stay') preview(next, undefined, { replace: true });
      return feed.markDone([row]);
    },
    notices: {
      succeeded: (decision) => toast.success(decisionOutcome(decision)),
      failed: (decision) => toast.failure(decisionFailure(decision)),
    },
  });

  /**
   * Complete one notification of a stack. The stack's last one completes the
   * row. An open preview of it moves to the stack's next notification, or its
   * previous one when it was the last.
   */
  const markNotificationDone = (
    row: NotificationInboxRow,
    notification: UnifiedNotification
  ) => {
    if (row.count <= 1) {
      markDone([row]);
      return;
    }
    if (selection.selectedNotification()?.id === notification.id) {
      const shown = row.content.notifications;
      const index = shown.findIndex(
        (candidate) => candidate.id === notification.id
      );
      const next = shown[index + 1] ?? shown[index - 1];
      if (next) preview(row, next);
      else preview(row);
    }
    fireAndForget(
      inbox.markNotificationDone(row, notification),
      'notifications-inbox'
    );
  };

  /**
   * Clear what the reader chose, under their filters. A preview of a row the
   * clear takes closes, as the list leaves it.
   */
  const clear = (choice: InboxClearChoice) => {
    const request = clearFor(choice, filters.filters(), new Date());
    const shown = selection.selected();
    if (shown && clearIncludes(request, shown)) closePreview();
    fireAndForget(inbox.clear(request), 'notifications-inbox');
  };

  const markDone = (done: readonly NotificationInboxRow[]) => {
    for (const row of done) stacks.collapse(row.id);
    const next = selection.afterLeaving(done.map((row) => row.id));
    if (next === 'none') closePreview({ replace: true });
    else if (next !== 'stay') preview(next, undefined, { replace: true });
    fireAndForget(inbox.markDone(done), 'notifications-inbox');
  };

  const [viewport, setViewport] = createSignal<HTMLDivElement>();
  const [virtualizer, setVirtualizer] = createSignal<VirtualizerHandle>();
  const viewportSize = createElementSize(viewport);
  const [topSpacer, setTopSpacer] = createSignal<HTMLDivElement>();
  const topSpacerSize = createElementSize(topSpacer);
  const [listFrame, setListFrame] = createSignal<HTMLDivElement>();

  const loadMore = () => fireAndForget(inbox.loadMore(), 'notifications-inbox');

  // A live change above what's being read shouldn't move it: note where the
  // first visible row is before the list changes, and put it back after. At the
  // top of the list new cards simply appear.
  let anchor: { id: string; top: number } | undefined;
  createComputed(
    on(
      listItems,
      () => {
        anchor = undefined;
        const container = viewport();
        if (!container || container.scrollTop <= 0) return;
        const edge = container.getBoundingClientRect().top;
        for (const row of container.querySelectorAll(
          '[data-notification-row],[data-stack-item]'
        )) {
          const { top, bottom } = row.getBoundingClientRect();
          if (bottom > edge) {
            anchor = { id: row.id, top };
            return;
          }
        }
      },
      { defer: true }
    )
  );
  createEffect(
    on(
      listItems,
      () => {
        const noted = anchor;
        const container = viewport();
        if (!noted || !container) return;
        // A new card is measured a moment after it mounts, so hold the row
        // in place for a few frames rather than correcting once.
        let frames = ANCHOR_HOLD_FRAMES;
        let frame = requestAnimationFrame(function hold() {
          const row = document.getElementById(noted.id);
          if (!row) return;
          container.scrollTop += row.getBoundingClientRect().top - noted.top;
          frames -= 1;
          if (frames > 0) frame = requestAnimationFrame(hold);
        });
        onCleanup(() => cancelAnimationFrame(frame));
      },
      { defer: true }
    )
  );

  useListInteractions({
    controller: list,
    scopeId: panel.splitHotkeyScope,
    enabled: panel.isPanelActive,
    scrollHandle: virtualizer,
    navigation: {
      onNavigate: (event) => {
        // An open preview follows the keyboard.
        const moved = rowOf(event.result?.item);
        if (moved && selection.selected()) {
          previewAfterMove(moved, notificationOf(event.result?.item));
        }
        if (event.kind !== 'move' || event.direction !== 1) return;
        if (!event.result || list.items.count() - event.result.index <= 4) {
          loadMore();
        }
      },
    },
    activation: {
      // A focused button, such as a stack's caret, answers Enter itself.
      shouldHandleKeyEvent: (event) =>
        !(event?.target instanceof Element && event.target.closest('button')),
      createMetadata: (intent) => ({ newSplit: intent === 'alternate' }),
      alternateDescription: t('nav.openInNewSplit'),
    },
    disclosure: {
      isHeader: () => false,
      // A stack answers for itself and for each notification unfolded from it.
      getKey: (item) => {
        const row = rowOf(item);
        return row && row.count > 1 ? row.id : undefined;
      },
      isExpanded: stacks.isExpanded,
      setExpanded: stacks.setExpanded,
      getFocusKey: (key) => key,
    },
  });

  registerHotkey({
    hotkey: ['e'],
    hotkeyToken: TOKENS.entity.action.markDone,
    scopeId: panel.splitHotkeyScope,
    description: () => t('notificationsInbox.markDone'),
    condition: () => panel.isPanelActive() && list.focus.item() !== undefined,
    keyDownHandler: (event) => {
      if (event?.repeat) return true;
      const item = list.focus.item();
      const row = rowOf(item);
      if (!row) return false;
      const notification = notificationOf(item);
      if (notification) markNotificationDone(row, notification);
      else markDone([row]);
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

  /** On touch, a left swipe marks the row or stack notification done. */
  const SwipeToDone = (swipe: { id: string; children: JSX.Element }) => (
    <Show when={isTouchDevice()} fallback={swipe.children}>
      <SwipableRow
        id={swipe.id}
        swipeLeftColor="bg-success"
        swipeLeftRevealedComponent={<CheckIcon class="size-8 text-surface" />}
      >
        {swipe.children}
      </SwipableRow>
    </Show>
  );

  const RowCard = (card: { row: () => NotificationInboxRow }) => {
    const display = createMemo(() => describeInboxCard(card.row(), context));
    const highlighted = () =>
      list.focus.key() === card.row().id ||
      (selection.selected()?.id === card.row().id &&
        // A chosen notification shows on its own line while it's visible.
        !(
          selection.selectedNotification() && stacks.isExpanded(card.row().id)
        ));
    return (
      <SwipeToDone id={card.row().id}>
        <NotificationRow
          id={card.row().id}
          icon={
            <InboxSenderAvatar
              notification={card.row().content.notifications[0]}
              kind={inboxCardKind(card.row())}
              entity={card.row().content.entity}
              badged
            />
          }
          who={display().who}
          what={display().what}
          body={display().body}
          time={formatTimestamp(new Date(card.row().latestAt))}
          count={card.row().count}
          unfolded={stacks.isExpanded(card.row().id)}
          unseen={card.row().unseen}
          highlighted={highlighted()}
          endsSection={sectionEnds().has(card.row().id)}
          receded={
            anyStackOpen() &&
            !stacks.isExpanded(card.row().id) &&
            !highlighted()
          }
          onHover={() => list.focus.set(card.row().id, { reason: 'hover' })}
          onClick={(event) =>
            list.activate.key(card.row().id, {
              reason: 'pointer',
              metadata: { event },
            })
          }
          onDone={() => markDone([card.row()])}
          onToggleStack={() => stacks.toggle(card.row().id)}
          actions={
            rowButtons(card.row()).length > 0 ? (
              <RowActionButtons
                actions={rowButtons(card.row())}
                pending={rowActions.pending(card.row().id)}
                onChoose={(action) =>
                  fireAndForget(
                    rowActions.run(card.row(), action),
                    'notifications-inbox'
                  )
                }
              />
            ) : undefined
          }
        />
      </SwipeToDone>
    );
  };

  const StackItemCard = (entry: {
    place: InboxStackItemPlace;
    row: () => NotificationInboxRow;
    notification: () => UnifiedNotification;
  }) => {
    const item = createMemo(() =>
      describeStackItem(entry.row(), entry.notification(), context)
    );
    const isLast = () =>
      entry.row().content.notifications.at(-1)?.id ===
      entry.place.notificationId;
    return (
      <SwipeToDone id={entry.place.id}>
        <NotificationStackItem
          id={entry.place.id}
          icon={
            <InboxSenderAvatar
              notification={entry.notification()}
              kind={inboxCardKind(entry.row())}
              entity={entry.row().content.entity}
              compact
            />
          }
          by={item().by}
          text={item().text}
          time={formatTimestamp(item().at)}
          last={isLast()}
          count={entry.row().count}
          endsSection={sectionEnds().has(entry.place.id)}
          more={
            isLast()
              ? entry.row().count - entry.row().content.notifications.length
              : 0
          }
          unseen={entry.row().unseen}
          highlighted={
            list.focus.key() === entry.place.id ||
            selection.selectedNotification()?.id === entry.place.notificationId
          }
          onHover={() => list.focus.set(entry.place.id, { reason: 'hover' })}
          onClick={(event) =>
            list.activate.key(entry.place.id, {
              reason: 'pointer',
              metadata: { event },
            })
          }
          onDone={() => markNotificationDone(entry.row(), entry.notification())}
          onToggleStack={() => {
            // Hide leaves with the item; focus returns to its stack's row.
            list.focus.set(entry.row().id, { reason: 'pointer' });
            stacks.toggle(entry.row().id);
          }}
        />
      </SwipeToDone>
    );
  };

  const listBody = () => (
    <Switch>
      <Match when={!filters.showsNothing() && view().t === 'loading'}>
        <ListSkeleton.Root
          label={t('notificationsInbox.loading')}
          class="touch:pt-(--mobile-content-inset-top)"
        >
          <div class="flex h-7 items-center px-4">
            <ListSkeleton.Bar class="h-2 w-16" />
          </div>
          <For each={[0, 1, 2, 3, 4]}>
            {() => (
              <ListSkeleton.Row class="h-[81px] items-start gap-3 px-4 py-3 touch:h-[81px] mobile:h-[87px]">
                <ListSkeleton.Bar class="size-6 shrink-0 rounded-full mobile:size-10" />
                <div class="flex min-w-0 flex-1 flex-col gap-2">
                  <ListSkeleton.Bar class="w-1/3" />
                  <ListSkeleton.Bar class="w-1/2" />
                  <ListSkeleton.Bar class="w-4/5" />
                </div>
              </ListSkeleton.Row>
            )}
          </For>
        </ListSkeleton.Root>
      </Match>
      <Match when={view().t === 'error'}>
        <ListStatus>
          <span>{t('notificationsInbox.loadFailed')}</span>
          <Button
            variant="secondary"
            size="sm"
            onClick={() =>
              fireAndForget(inbox.refresh(), 'notifications-inbox')
            }
          >
            {t('notificationsInbox.tryAgain')}
          </Button>
        </ListStatus>
      </Match>
      <Match when={filters.showsNothing()}>
        <ListStatus>
          <span>{t('notificationsInbox.allHidden')}</span>
          <Button variant="secondary" size="sm" onClick={filters.reset}>
            {t('notificationsInbox.resetFilters')}
          </Button>
        </ListStatus>
      </Match>
      <Match when={view().t === 'empty' && filters.activeCount() > 0}>
        <ListStatus>
          <span>{t('notificationsInbox.noMatches')}</span>
          <Button variant="secondary" size="sm" onClick={filters.reset}>
            {t('notificationsInbox.resetFilters')}
          </Button>
        </ListStatus>
      </Match>
      <Match when={view().t === 'empty'}>
        <div class="min-h-0 flex-1 overflow-y-auto touch:pt-(--mobile-content-inset-top)">
          <EmptyStatePanel
            centered
            graphic={EmptyStateInboxTrayGraphic}
            title={t('notificationsInbox.caughtUpTitle')}
            description={t('notificationsInbox.caughtUpDescription')}
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
              data={listItems()}
              scrollRef={viewport()}
              startMargin={isTouchDevice() ? (topSpacerSize.height ?? 0) : 0}
              bufferSize={500}
              itemSize={95}
              keepMounted={
                list.focus.index() >= 0 ? [list.focus.index()] : undefined
              }
              onScroll={checkNearEnd}
            >
              {(item) =>
                match(item)
                  .with({ type: 'row' }, (place) => (
                    <Show when={rowsById().get(place.id)}>
                      {(row) => <RowCard row={row} />}
                    </Show>
                  ))
                  .with({ type: 'stack_item' }, (place) => (
                    <Show when={rowOf(place)}>
                      {(row) => (
                        <Show when={notificationOf(place)}>
                          {(notification) => (
                            <StackItemCard
                              place={place}
                              row={row}
                              notification={notification}
                            />
                          )}
                        </Show>
                      )}
                    </Show>
                  ))
                  .with({ type: 'date_header' }, (header) => (
                    <InboxDateHeader
                      id={header.id}
                      label={dateHeaderLabel(header)}
                      isFirst={listItems()[0]?.id === header.id}
                    />
                  ))
                  .exhaustive()
              }
            </Virtualizer>
          </Suspense>
        </div>
      </Match>
    </Switch>
  );

  const filterControls = {
    isShown: filters.isShown,
    get activeCount() {
      return filters.activeCount();
    },
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
            <InboxStatusPills
              status={filters.filters().status}
              onChange={filters.setStatus}
              leading={
                <>
                  <InboxFilterDrawer {...filterControls} />
                  <InboxClearDrawer
                    unreadOnly={filters.filters().status === 'unread'}
                    isShown={filters.isShown}
                    onClear={clear}
                  />
                </>
              }
            />
          </header>
          <PullToRefresh
            scrollContainer={() => viewport() ?? listFrame()}
            onRefresh={inbox.refresh}
          />
          <SwipableRowProvider
            container={viewport}
            canSwipeLeft={(id) =>
              rowsById().has(id) || stackItemOf(id) !== undefined
            }
            onSwipeLeft={(id) => {
              const row = rowsById().get(id);
              if (row) {
                markDone([row]);
                return;
              }
              const place = stackItemOf(id);
              const stackRow = rowOf(place);
              const notification = notificationOf(place);
              if (stackRow && notification) {
                markNotificationDone(stackRow, notification);
              }
            }}
          >
            <div
              role="grid"
              aria-label={t('nav.notifications')}
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

  // One editor renders every card's text; without it each line of each card
  // builds its own.
  return (
    <StaticMarkdownContext>
      <SplitPanel.Root>
        <SplitPanel.Body>
          <Show when={!isTouchDevice()} fallback={touchLayout()}>
            <div class="size-full min-h-0 bg-panel">
              <ViewShell.Root
                asidePreferenceKey="notifications"
                // Rows read as sentences, so the list starts wider than a nav rail.
                aside={{ width: 360, max: 480, preserveDuringResize: false }}
                // Narrow, the list and what it opens take turns.
                asideList={{
                  open:
                    props.calendarPreview.isOpen() ||
                    previewTarget() !== undefined,
                  onBack: () => closePreview(),
                }}
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
                        <InboxClearMenu
                          unreadOnly={filters.filters().status === 'unread'}
                          isShown={filters.isShown}
                          onClear={clear}
                        />
                        <Button
                          size="icon-md"
                          variant="ghost"
                          aria-label={t('notificationsInbox.settings')}
                          tooltip={t('notificationsInbox.settings')}
                          onClick={() => props.onOpenSettings()}
                        >
                          <GearSixIcon class="size-4" />
                        </Button>
                      </>
                    }
                  />
                  <div class="shrink-0 px-3 pb-1">
                    <InboxStatusTabs
                      status={filters.filters().status}
                      onChange={filters.setStatus}
                    />
                  </div>
                  <div
                    role="grid"
                    aria-label={t('nav.notifications')}
                    aria-activedescendant={list.focus.key()}
                    tabIndex={0}
                    class="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden outline-none"
                  >
                    {listBody()}
                  </div>
                </ViewShell.Aside>
                <ViewShell.Main class="overflow-hidden">
                  <NotificationsCalendarPaneProvider
                    value={{ refocus: props.calendarPreview.refocus }}
                  >
                    {/* A calendar event shows under the view's calendar route,
                      which loads lazily: suspend only this pane, so the list
                      keeps its place. */}
                    <Suspense>
                      <SplitRouter.Outlet
                        fallback={() => (
                          <Show
                            when={previewTarget()}
                            fallback={<NotificationsNoneSelected />}
                          >
                            <PreviewPanel
                              target={previewTarget()}
                              navigationRequest={selection.navigationRequest()}
                              orchestrator={orchestrator}
                              splitPanelContext={panel}
                            />
                          </Show>
                        )}
                      />
                    </Suspense>
                  </NotificationsCalendarPaneProvider>
                </ViewShell.Main>
              </ViewShell.Root>
            </div>
          </Show>
        </SplitPanel.Body>
      </SplitPanel.Root>
    </StaticMarkdownContext>
  );
}
