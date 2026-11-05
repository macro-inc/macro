import { t } from '@app/lib/i18n';
import type { UnifiedNotification } from '@notifications/types';
import type {
  InboxDoneResult,
  InboxFeedSource,
  NotificationInboxRow,
} from '../context/notifications-inbox-context';
import type { InboxClear } from '../core/inbox-filters';
import { traceInboxClear, traceInboxRows } from './inbox-telemetry';

/** What the inbox list shows. */
export type InboxListView =
  | { t: 'loading' }
  | { t: 'error' }
  /** `filtered` when rows exist but the status filter hides them all. */
  | { t: 'empty'; filtered: boolean }
  | {
      t: 'ready';
      rows: readonly NotificationInboxRow[];
      hasMore: boolean;
      loadingMore: boolean;
      /** A refresh failed while earlier rows stay on screen. */
      stale: boolean;
    };

/** How completed and failed dones are announced and reversed. */
export type InboxDoneNotices = {
  /**
   * Put a done on the app's undo stack; the handle's `undo` reverses it and
   * the entry's `onUndone` runs however it was undone.
   */
  pushUndo: (entry: {
    label: string;
    undo: () => Promise<void>;
    onUndone: () => void;
  }) => { undo: () => Promise<void> };
  /** Announce a completed done with an Undo action; returns its dismissal. */
  announceDone: (count: number, undo: () => Promise<void>) => () => void;
  /**
   * Announce a completed clear of `count` rows, with an Undo action when it
   * took any; returns its dismissal.
   */
  announceCleared: (count: number, undo: () => Promise<void>) => () => void;
  announceFailure: (message: string) => void;
};

/**
 * The inbox list's state and actions over one feed, showing the rows
 * `include` admits. Loaded rows stay on screen through a failed refresh,
 * and an empty page that has more to load is still ready so the view keeps
 * paging.
 */
export function createInboxList(
  feed: InboxFeedSource,
  notices: InboxDoneNotices,
  include: (row: NotificationInboxRow) => boolean = () => true
) {
  const view = (): InboxListView => {
    const loaded = feed.rows();
    const error = feed.error();
    if (loaded === undefined) {
      return error ? { t: 'error' } : { t: 'loading' };
    }
    // ast-grep-ignore: ts-no-client-list-filter -- predates FE-71: unread tab: keeps `unseen` rows plus rows read in place; make it a query input.
    const rows = loaded.filter(include);
    if (rows.length === 0 && !feed.hasMore()) {
      return error
        ? { t: 'error' }
        : { t: 'empty', filtered: loaded.length > 0 };
    }
    return {
      t: 'ready',
      rows,
      hasMore: feed.hasMore(),
      loadingMore: feed.isLoadingMore(),
      stale: error !== undefined,
    };
  };

  /** Put a completed done on the undo stack and announce it. */
  const offerUndo = (
    rows: readonly NotificationInboxRow[],
    count: number,
    result: InboxDoneResult,
    announce: InboxDoneNotices['announceDone'] = notices.announceDone,
    label = t('notificationsInbox.markDone')
  ) => {
    let dismiss = () => {};
    const handle = notices.pushUndo({
      label,
      undo: async () => {
        try {
          await traceInboxRows('notifications_inbox.row_undo', rows, () =>
            result.undo()
          );
        } catch (error) {
          notices.announceFailure(t('notificationsInbox.undoFailed'));
          throw error;
        }
      },
      onUndone: () => dismiss(),
    });
    dismiss = announce(count, handle.undo);
  };

  const markDone = async (rows: readonly NotificationInboxRow[]) => {
    if (rows.length === 0) return;
    let result: InboxDoneResult;
    try {
      result = await traceInboxRows('notifications_inbox.row_done', rows, () =>
        feed.markDone(rows)
      );
    } catch {
      notices.announceFailure(
        t('notificationsInbox.markDoneFailed', { count: rows.length })
      );
      return;
    }
    offerUndo(rows, rows.length, result);
  };

  /** Complete one notification of a stack, leaving the rest of it. */
  const markNotificationDone = async (
    row: NotificationInboxRow,
    notification: UnifiedNotification
  ) => {
    let result: InboxDoneResult;
    try {
      result = await traceInboxRows(
        'notifications_inbox.notification_done',
        [row],
        (span) => {
          span.setAttr('notification.id', notification.id);
          return feed.markNotificationDone(row, notification);
        }
      );
    } catch {
      notices.announceFailure(
        t('notificationsInbox.markDoneFailed', { count: 1 })
      );
      return;
    }
    offerUndo([row], 1, result);
  };

  /** Clear the whole inbox of what `clear` takes. */
  const clear = async (request: InboxClear) => {
    let result: Awaited<ReturnType<InboxFeedSource['clear']>>;
    try {
      result = await traceInboxClear(request, () => feed.clear(request));
    } catch {
      notices.announceFailure(t('notificationsInbox.clearFailed'));
      return;
    }
    if (result.count === 0) {
      notices.announceCleared(0, result.undo);
      return;
    }
    offerUndo(
      [],
      result.count,
      result,
      notices.announceCleared,
      t('notificationsInbox.clear')
    );
  };

  return {
    view,
    clear,
    markDone,
    markNotificationDone,
    loadMore: feed.loadMore,
    refresh: feed.refresh,
  };
}
