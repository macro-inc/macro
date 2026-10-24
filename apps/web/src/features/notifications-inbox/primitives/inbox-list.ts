import type {
  InboxFeedSource,
  NotificationInboxRow,
} from '../context/notifications-inbox-context';
import { traceInboxRows } from './inbox-telemetry';

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

  const markDone = async (rows: readonly NotificationInboxRow[]) => {
    if (rows.length === 0) return;
    let result: Awaited<ReturnType<InboxFeedSource['markDone']>>;
    try {
      result = await traceInboxRows('notifications_inbox.row_done', rows, () =>
        feed.markDone(rows)
      );
    } catch {
      notices.announceFailure(
        rows.length > 1
          ? 'Couldn’t mark these notifications as done'
          : 'Couldn’t mark this notification as done'
      );
      return;
    }
    let dismiss = () => {};
    const handle = notices.pushUndo({
      label: 'Mark Done',
      undo: async () => {
        try {
          await traceInboxRows('notifications_inbox.row_undo', rows, () =>
            result.undo()
          );
        } catch (error) {
          notices.announceFailure('Failed to undo');
          throw error;
        }
      },
      onUndone: () => dismiss(),
    });
    dismiss = notices.announceDone(rows.length, handle.undo);
  };

  return {
    view,
    markDone,
    loadMore: feed.loadMore,
    refresh: feed.refresh,
  };
}
