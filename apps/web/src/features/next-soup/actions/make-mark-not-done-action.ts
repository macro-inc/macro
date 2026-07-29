import {
  applyEntitiesNotDoneOptimistic,
  executeMarkEntitiesUndone,
  resolveMarkEntitiesDoneVariables,
} from '@app/features/next-soup/utils';
import { toast } from '@core/component/Toast/Toast';
import type { EntityData } from '@entity';
import type { NotificationSource } from '@notifications';
import { threadCanBeMarkedNotDone } from '@queries/email/thread';
import { fetchDoneNotificationIdsByEventItemIds } from '@queries/notification/user-notifications';
import { invalidateAllSoup, refetchSoupEntity } from '@queries/soup/cache';
import type { SoupState } from '../create-soup-state';

type MakeMarkNotDoneOptions = {
  notificationSource: () => NotificationSource;
};

/**
 * Reverses a mark-done: unarchives email threads and restores their
 * notifications. Only done emails qualify — other entity types' done state
 * lives on their notifications, and their rows never render as done in the
 * mark-done-capable views. Threads whose done state can't be reversed (no
 * inbound message) are dropped at execute time; see
 * `threadCanBeMarkedNotDone`.
 */
export const makeMarkNotDoneAction = (options: MakeMarkNotDoneOptions) => {
  const canExecute = (entity: EntityData): boolean =>
    entity.type === 'email' && entity.done === true;

  const execute = async (entities: EntityData[]) => {
    const candidates = entities.filter(canExecute);
    if (candidates.length === 0) return;

    // `done` alone doesn't mean the state is reversible — a thread with only
    // sent messages is permanently done. Soup rows can't tell, so resolve it
    // from the thread itself (cached when the thread is open).
    const eligibility = await Promise.all(
      candidates.map((entity) => threadCanBeMarkedNotDone(entity.id))
    );
    const targets = candidates.filter((_, i) => eligibility[i]);

    if (targets.length === 0) {
      toast.alert(
        candidates.length > 1
          ? 'These threads have no received messages, so they stay done'
          : 'This thread has no received messages, so it stays done',
        { duration: 4_000 }
      );
      return;
    }

    const { emailIds, notificationIds } = resolveMarkEntitiesDoneVariables({
      entities: targets,
      notificationSource: options.notificationSource(),
    });

    const optimistic = applyEntitiesNotDoneOptimistic({
      emailIds,
      notificationIds,
    });

    try {
      // The live notification stream only carries not-done notifications, so
      // a done thread's ids may have aged out of the local cache — resolve
      // them from the server and merge before restoring.
      const serverNotificationIds =
        await fetchDoneNotificationIdsByEventItemIds(emailIds);
      await executeMarkEntitiesUndone({
        emailIds,
        notificationIds: [
          ...new Set([...notificationIds, ...serverNotificationIds]),
        ],
      });
      // Match the mark-done action's success feedback (and the direct
      // unarchive fallback's toast in EmailContext).
      toast.success(
        targets.length > 1
          ? `Marked ${targets.length} items as not done`
          : 'Marked as not done',
        { duration: 3_000, stack: true, hideOnMobile: true }
      );
      // Restore the rows deterministically: refetch each thread's soup item
      // and upsert it into the caches (flat, grouped parents, and expanded
      // group queries), then refetch the lists so done-filtered views
      // reconcile membership and ordering.
      await Promise.all(
        emailIds.map((id) => refetchSoupEntity(id, 'emailThread'))
      );
      invalidateAllSoup();
    } catch (err) {
      optimistic.rollback();
      toast.failure('Failed to mark as not done');
      // Rethrow (matching makeMarkDoneAction's mutateAsync) so wrappers like
      // trackExternalThreadArchive can restore their own caches; UI feedback
      // is already handled above.
      throw err;
    }
  };

  /** Signature parity with makeMarkDoneAction's executeWithSoup — no
   *  navigation or collapse: the rows stay in place. */
  const executeWithSoup = async (entities: EntityData[], _soup: SoupState) => {
    await execute(entities);
  };

  return { canExecute, execute, executeWithSoup };
};
