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
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { fireAndForget } from '@core/util/fireAndForget';
import ArrowCounterClockwise from '@icon/system/regular/arrow-counter-clockwise.svg?component-solid';
import { compositeEntity, setDoneOverride } from '@notifications';
import {
  trackExternalThreadArchive,
  useUndoableArchiveThreadMutation,
} from '@queries/email/thread';
import {
  bulkMarkNotificationsAsDone,
  bulkMarkNotificationsAsUndone,
  fetchDoneNotificationIdsByEventItemIds,
} from '@queries/notification/user-notifications';
import { getSoupEntityById } from '@queries/soup/cache';
import {
  isDisplayableSoupItem,
  mapApiSoupItemToEntity,
} from '@queries/soup/transform-utils';
import type { Accessor } from 'solid-js';
import type {
  ArchiveThreadOptions,
  EmailThreadCommands,
} from './context/email-thread-context';
export function createThreadCompletionAdapter(
  threadSource: Accessor<EmailThread | undefined>
): Pick<
  EmailThreadCommands,
  | 'archiveThread'
  | 'isThreadDone'
  | 'canMarkThreadNotDone'
  | 'markThreadNotDone'
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
          dismissStyle: 'icon',
          actionLayout: 'inline',
          actions: [
            {
              label: 'Undo',
              icon: ArrowCounterClockwise,
              onClick: () => {
                fireAndForget(
                  handle.undo({
                    onError: () => toast.failure('Failed to undo'),
                  }),
                  'email-thread'
                );
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
      // notification side effects for the resulting state.
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

  const isThreadDone = () => {
    const thread = threadSource();
    return thread ? !thread.inbox_visible : false;
  };

  // A thread with no received mail can never leave the archive. Older sent-only
  // threads read as having received mail until they are recomputed, so the
  // server still has the final say.
  const canMarkThreadNotDone = () => {
    const thread = threadSource();
    return (
      !!thread && !thread.inbox_visible && thread.has_received_mail !== false
    );
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
    // only mirrors its preview handling via trackExternalThreadArchive.
    const { selectedRow, cachedItem } = resolveThreadSoupLookup(thread.db_id);

    const entity =
      selectedRow?.original ??
      (cachedItem &&
      isDisplayableSoupItem(cachedItem) &&
      cachedItem.tag !== 'channelThread' &&
      cachedItem.tag !== 'calendarEvent'
        ? mapApiSoupItemToEntity(cachedItem)
        : undefined);

    if (entity && markNotDoneAction.canExecute(entity)) {
      fireAndForget(
        trackExternalThreadArchive(markNotDoneAction.execute([entity])),
        'email-thread'
      );
    } else {
      // No soup entity to drive the action from — the mark-done removal
      // evicted it from the soup caches (or its done state hasn't caught up
      // with the thread's): unarchive directly.
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
        { threadId, archive: false },
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
      navigateBack: opts?.navigateBack,
    };

    if (!thread?.db_id) return false;

    if (!thread.inbox_visible) return false;

    // Mark done issues the /archived request itself (with undo support), so
    // the paths below skip archiveMutation and only mirror its preview
    // handling via trackExternalThreadArchive.
    const { selectedRow, cachedItem } = resolveThreadSoupLookup(thread.db_id);
    const entity =
      selectedRow?.original ??
      (cachedItem &&
      isDisplayableSoupItem(cachedItem) &&
      cachedItem.tag !== 'channelThread' &&
      cachedItem.tag !== 'calendarEvent'
        ? mapApiSoupItemToEntity(cachedItem)
        : buildEntityData({
            blockName: 'email',
            id: thread.db_id,
            name: thread.messages.at(-1)?.subject || 'Email Thread',
            isRead: thread.is_read,
            done: !thread.inbox_visible,
          }));
    if (!entity) return false;

    if (opts?.navigate !== false && soup && selectedRow) {
      fireAndForget(
        trackExternalThreadArchive(
          markAsDoneAction.executeWithSoup(
            [entity],
            soup,
            ({ entity: nextEntity }) => {
              const splitHandle = splitPanel?.handle;
              if (!splitHandle) return;
              if (!nextEntity) {
                return;
              }

              fireAndForget(
                openEntityInSplitFromUnifiedList(nextEntity, {
                  splitHandle,
                  mergeHistory: !isTouchDevice(),
                  referredFrom: splitHandle.referredFrom(),
                }),
                'email-thread'
              );
            },
            markDoneOpts
          )
        ),
        'email-thread'
      );
    } else {
      fireAndForget(
        trackExternalThreadArchive(
          markAsDoneAction.execute([entity], undefined, markDoneOpts)
        ),
        'email-thread'
      );
    }

    return true;
  };

  return {
    archiveThread,
    isThreadDone,
    canMarkThreadNotDone,
    markThreadNotDone,
  };
}
