import type { EmailThread } from '@app/features/email-thread/core/email-thread';
import { buildEntityData } from '@app/features/entity/utils/buildEntityData';
import {
  makeMarkDoneAction,
  makeMarkNotDoneAction,
} from '@app/features/next-soup/actions';
import { useMaybeSoup } from '@app/features/next-soup/soup-context';
import { openEntityInSplitFromUnifiedList } from '@app/features/next-soup/utils';
import { useGlobalNotificationSource } from '@components/app/GlobalAppState';
import { useSplitPanel } from '@components/app/split-layout/layoutUtils';
import { toast } from '@core/component/Toast/Toast';
import { useUserId } from '@core/context/user';
import { compositeEntity, setDoneOverride } from '@notifications';
import ArrowCounterClockwise from '@phosphor-icons/core/regular/arrow-counter-clockwise.svg?component-solid';
import {
  trackExternalThreadArchive,
  useUndoableArchiveThreadMutation,
} from '@queries/email/thread';
import {
  bulkMarkNotificationsAsDone,
  bulkMarkNotificationsAsUndone,
  fetchDoneNotificationIdsByEventItemIds,
} from '@queries/notification/user-notifications';
import {
  getSoupEntityById,
  invalidateAllSoup,
  refetchSoupEntity,
} from '@queries/soup/cache';
import { mapApiSoupItemToEntity } from '@queries/soup/transform-utils';
import type { Accessor } from 'solid-js';

import type {
  ArchiveThreadOptions,
  EmailThreadCommands,
} from './context/email-thread-context';
export function createThreadCompletionAdapter(
  threadSource: Accessor<EmailThread | undefined>,
  toHeaderLinkId: (linkId: string | null | undefined) => string | undefined
): Pick<
  EmailThreadCommands,
  | 'archiveThread'
  | 'isThreadDone'
  | 'canMarkThreadNotDone'
  | 'markThreadNotDone'
  | 'getMarkDoneNavigationTargetId'
> {
  const notificationSource = useGlobalNotificationSource();
  const soup = useMaybeSoup();
  const splitPanel = useSplitPanel();

  const userId = useUserId();

  const markAsDoneAction = makeMarkDoneAction({
    notificationSource: () => notificationSource,
    userId,
  });

  const markNotDoneAction = makeMarkNotDoneAction({
    notificationSource: () => notificationSource,
  });

  // Notification ids the mark-not-done fallback restored, per thread, so the
  // undo/redo hooks below can re-mark them when the archive flip is replayed.
  const restoredNotificationIds = new Map<string, string[]>();

  // Only the direct unarchive fallback goes through this mutation
  // (the mark-done / mark-not-done action paths toast on their own).
  const archiveMutation = useUndoableArchiveThreadMutation({
    onPushed: (handle, params) => {
      params.onUndoHandle?.(handle);
      const message = params.archive ? 'Marked as done' : 'Marked as not done';
      let toastId: number | undefined;

      const showToast = () => {
        if (params.silent) return;
        toastId = toast.success(message, {
          actions: [
            {
              label: 'Undo',
              icon: ArrowCounterClockwise,
              onClick: () => {
                handle.undo({
                  onError: () => toast.failure('Failed to undo'),
                });
              },
            },
          ],
          duration: 3_000,
          stack: true,
          hideOnMobile: true,
        });
      };

      showToast();

      // Undo/redo replay only the /archived flip; mirror the fallback's
      // notification and soup-list side effects for the resulting state.
      const syncSideEffects = (nowArchived: boolean) => {
        const ids = restoredNotificationIds.get(params.threadId) ?? [];
        if (ids.length > 0) {
          setDoneOverride(ids, nowArchived);
          void (
            nowArchived
              ? bulkMarkNotificationsAsDone(ids)
              : bulkMarkNotificationsAsUndone(ids)
          ).catch(() => setDoneOverride(ids, undefined));
        }
        if (!nowArchived) {
          void refetchSoupEntity(params.threadId, 'emailThread');
        }
        invalidateAllSoup();
      };

      return {
        onUndone: () => {
          if (toastId !== undefined) toast.dismiss(toastId);
          syncSideEffects(!params.archive);
        },
        onRedone: () => {
          showToast();
          syncSideEffects(params.archive);
        },
      };
    },
    onError: (params) => {
      toast.failure(
        params.archive ? 'Failed to mark as done' : 'Failed to mark as not done'
      );
    },
  });

  const getMarkDoneNavigationTargetId = () => {
    if (!soup) return;

    const focusedId = soup.focus.id();
    const navigationOptions = {
      wrapNavigation: false,
      skipGroupHeaders: true,
      skipLoadMore: true,
    };
    const candidates = [
      soup.navigate.peekOffset(1, navigationOptions)?.row,
      soup.navigate.peekOffset(-1, navigationOptions)?.row,
    ];
    return candidates.find((row) => row && row.id !== focusedId)?.id;
  };

  const isThreadDone = () => {
    const thread = threadSource();
    return thread ? !thread.inbox_visible : false;
  };

  // Doneness is derived, not stored: `inbox_visible` is recomputed from the
  // thread's messages as "some message has INBOX and not SENT", and the inbox
  // view additionally requires an inbound message. A thread with only sent
  // messages can satisfy neither, so it is permanently done — unarchiving it
  // reverts on the next recompute and meanwhile labels its sent messages
  // INBOX, in Gmail too. Only offer the reversal when it can hold.
  const canMarkThreadNotDone = () => {
    const thread = threadSource();
    if (!thread) return false;
    return !thread.inbox_visible && thread.latest_inbound_message_ts != null;
  };

  // Resolve a thread's soup representation for the mark-done / mark-not-done
  // paths: the live list row when it's rendered, else the normalized
  // soup-cache entity. Shared by markThreadNotDone and archiveThread.
  const resolveThreadSoupLookup = (threadId: string) => {
    const selectedRow = soup?.items.get(threadId);
    const cachedItem = selectedRow ? undefined : getSoupEntityById(threadId);
    return { selectedRow, cachedItem };
  };

  const markThreadNotDone = () => {
    const thread = threadSource();
    if (!thread?.db_id) return false;

    if (thread.inbox_visible) return false;

    if (!canMarkThreadNotDone()) return false;

    // Mark-not-done issues the /archived request itself (plus notification
    // and soup-cache restore), so the path below skips archiveMutation and
    // only mirrors its thread-cache handling via trackExternalThreadArchive.
    const { selectedRow, cachedItem } = resolveThreadSoupLookup(thread.db_id);

    const entity =
      selectedRow?.original ??
      (cachedItem &&
      cachedItem.tag !== 'channelThread' &&
      cachedItem.tag !== 'calendarEvent'
        ? mapApiSoupItemToEntity(cachedItem)
        : undefined);

    if (entity && markNotDoneAction.canExecute(entity)) {
      void trackExternalThreadArchive(
        thread.db_id,
        markNotDoneAction.execute([entity]),
        false
      );
    } else {
      // No soup entity to drive the action from — the mark-done removal
      // evicted it from the soup caches (or its done state hasn't caught up
      // with the thread's): unarchive directly, then refetch the thread's
      // soup item to reinsert its rows and refetch the lists.
      const threadId = thread.db_id;
      // Snapshot the thread's notification ids now — the entity path restores
      // them via executeMarkEntitiesUndone, so mirror that here or they stay
      // done after the unarchive.
      const notificationIds = (
        notificationSource.notificationsByEntity()[
          compositeEntity({ type: 'email_thread', id: threadId })
        ] ?? []
      ).map((n) => n.id);
      archiveMutation.mutate(
        {
          threadId,
          archive: false,
          linkId: toHeaderLinkId(thread.link_id),
        },
        {
          onSuccess: async () => {
            // The live notification stream only carries not-done
            // notifications, so the thread's done ids may have aged out of
            // the local cache — merge the server's view (best effort: the
            // unarchive itself already succeeded).
            const serverIds = await fetchDoneNotificationIdsByEventItemIds([
              threadId,
            ]).catch(() => []);
            const allIds = [...new Set([...notificationIds, ...serverIds])];
            // Record for the undo/redo hooks, which re-mark these when the
            // archive flip is replayed.
            restoredNotificationIds.set(threadId, allIds);
            if (allIds.length > 0) {
              setDoneOverride(allIds, false);
              try {
                await bulkMarkNotificationsAsUndone(allIds);
              } catch {
                // The unarchive itself succeeded, so keep that outcome and
                // let the override fall back to the server's done state.
                setDoneOverride(allIds, undefined);
                toast.failure('Failed to mark as not done');
              }
            }
            void refetchSoupEntity(threadId, 'emailThread');
            invalidateAllSoup();
          },
        }
      );
    }

    return true;
  };

  const archiveThread = (opts?: ArchiveThreadOptions) => {
    const thread = threadSource();
    // `=== true` because callers may pass this straight to an event handler.
    const markDoneOpts = {
      silent: opts?.silent === true,
      onUndoHandle: opts?.onUndoHandle,
      nextEntityId: opts?.nextEntityId,
    };

    if (!thread?.db_id) return false;

    if (!thread.inbox_visible) return false;

    // Mark done issues the /archived request itself (with undo support), so
    // the paths below skip archiveMutation and only mirror its thread-cache
    // handling via trackExternalThreadArchive.
    const { selectedRow, cachedItem } = resolveThreadSoupLookup(thread.db_id);

    if (soup && selectedRow) {
      void trackExternalThreadArchive(
        thread.db_id,
        markAsDoneAction.executeWithSoup(
          [selectedRow.original],
          soup,
          (nextEntity) => {
            const splitHandle = splitPanel?.handle;
            if (!splitHandle) return;
            void openEntityInSplitFromUnifiedList(nextEntity, {
              splitHandle,
              mergeHistory: true,
              referredFrom: splitHandle.referredFrom(),
            });
          },
          markDoneOpts
        )
      );
    } else if (
      cachedItem &&
      cachedItem.tag !== 'channelThread' &&
      cachedItem.tag !== 'calendarEvent'
    ) {
      // Not rendered inside a soup list (e.g. thread opened in a split): no
      // row to drive the action from, so mark done via the cached soup entity
      // so soup views drop the thread and its notifications settle.
      void trackExternalThreadArchive(
        thread.db_id,
        markAsDoneAction.execute(
          [mapApiSoupItemToEntity(cachedItem)],
          undefined,
          markDoneOpts
        )
      );
    } else {
      // Direct navigation may have no soup entity. Use the loaded thread so
      // notifications and archive state share the same completion and undo.
      const entity = buildEntityData({
        blockName: 'email',
        id: thread.db_id,
        name: thread.messages.at(-1)?.subject || 'Email Thread',
        isRead: thread.is_read,
        done: !thread.inbox_visible,
      });
      if (!entity) return false;

      void trackExternalThreadArchive(
        thread.db_id,
        markAsDoneAction.execute([entity], undefined, markDoneOpts)
      );
    }

    return true;
  };

  return {
    archiveThread,
    isThreadDone,
    canMarkThreadNotDone,
    markThreadNotDone,
    getMarkDoneNavigationTargetId,
  };
}
