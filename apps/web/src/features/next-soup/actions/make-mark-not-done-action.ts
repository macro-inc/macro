import {
  applyEntitiesNotDoneOptimistic,
  executeMarkEntitiesUndone,
  resolveMarkEntitiesDoneVariables,
} from '@app/features/next-soup/utils';
import { t } from '@app/lib/i18n';
import { toast } from '@core/component/Toast/Toast';
import type { EntityData } from '@entity';
import type { NotificationSource } from '@notifications';
import type { EmailArchiveDisposition } from '@queries/email/integration';
import { fetchDoneNotificationIdsByEventItemIds } from '@queries/notification/user-notifications';
import { canMarkNotDone } from './can-mark-not-done';
import type { EntityActionListState } from './entity-action-context';

type MakeMarkNotDoneOptions = {
  notificationSource: () => NotificationSource;
};

/** Each email owns its optimistic state; rejected siblings cannot undo it. */
async function unarchiveTargets(targets: EntityData[]) {
  const attempts = new Map(
    targets.map((entity) => [
      entity.id,
      {
        entity,
        optimistic: applyEntitiesNotDoneOptimistic({
          emailIds: [entity.id],
          notificationIds: [],
        }),
      },
    ])
  );
  const results = new Map<
    string,
    PromiseSettledResult<EmailArchiveDisposition>
  >();
  let error: unknown;
  try {
    await executeMarkEntitiesUndone({
      emailIds: [...attempts.keys()],
      notificationIds: [],
      onEmailSettled: (id, result) => {
        results.set(id, result);
        const optimistic = attempts.get(id)?.optimistic;
        if (result.status === 'fulfilled') optimistic?.settle();
        else optimistic?.rollback();
      },
    });
  } catch (err) {
    error = err;
  }
  const accepted: EntityData[] = [];
  let disposition: EmailArchiveDisposition = 'committed';
  for (const [id, attempt] of attempts) {
    const result = results.get(id);
    if (!result) attempt.optimistic.rollback(); // Failure before writes started.
    if (result?.status !== 'fulfilled') continue;
    accepted.push(attempt.entity);
    if (result.value === 'queued') disposition = 'queued';
  }
  return { accepted, disposition, error };
}

/** Restore notifications only after the corresponding unarchive was accepted. */
async function restoreEmailNotifications(
  entities: EntityData[],
  source: NotificationSource
) {
  const { emailIds, notificationIds } = resolveMarkEntitiesDoneVariables({
    entities,
    notificationSource: source,
  });
  const optimistic = applyEntitiesNotDoneOptimistic({
    emailIds: [],
    notificationIds,
  });
  try {
    const serverIds = await fetchDoneNotificationIdsByEventItemIds(emailIds);
    await executeMarkEntitiesUndone({
      emailIds: [],
      notificationIds: [...new Set([...notificationIds, ...serverIds])],
    });
    optimistic.settle();
    return true;
  } catch {
    // Notification lookup/write failure cannot reverse an accepted archive write.
    optimistic.rollback();
    return false;
  }
}

/**
 * Reverses a mark-done: unarchives email threads and restores their
 * notifications. The server validates unarchive eligibility (received-mail
 * history), and the per-thread transactions below isolate its rejections. Each
 * thread settles independently, including queued writes; only a completely
 * failed email selection rejects the action.
 */
export const makeMarkNotDoneAction = (options: MakeMarkNotDoneOptions) => {
  const execute = async (entities: EntityData[]) => {
    // Snapshot identities before awaiting and deduplicate group occurrences.
    const targets = [
      ...new Map(
        entities
          .filter(canMarkNotDone)
          .map((entity) => [entity.id, { ...entity }] as const)
      ).values(),
    ];
    if (targets.length === 0) return;

    const source = options.notificationSource();
    const { accepted, disposition, error } = await unarchiveTargets(targets);
    if (accepted.length === 0) {
      toast.failure(t('entityActions.toastMarkNotDoneFailed'));
      // Single-thread wrappers still need rejection to restore their own cache.
      throw error ?? new Error('Failed to mark as not done');
    }

    const warnings: string[] = [];
    const failedCount = targets.length - accepted.length;
    if (failedCount > 0)
      warnings.push(
        t('entityActions.toastCountNotRestored', { count: failedCount })
      );
    if (!(await restoreEmailNotifications(accepted, source))) {
      warnings.push(t('entityActions.toastNotificationsNotRestored'));
    }
    const message =
      failedCount > 0
        ? t('entityActions.toastMarkedNotDonePartial', {
            accepted: accepted.length,
            count: targets.length,
          })
        : accepted.length > 1
          ? t('entityActions.toastMarkedNotDoneCount', {
              count: accepted.length,
            })
          : t('entityActions.toastMarkedNotDone');
    const feedback = { duration: 3_000, stack: true, hideOnMobile: true };
    if (warnings.length > 0)
      toast.alert(
        t('entityActions.toastWithWarnings', {
          message,
          warnings: warnings.join(' '),
        }),
        {
          ...feedback,
          hideOnMobile: false,
        }
      );
    else toast.success(message, feedback);
    return disposition;
  };

  /** Signature parity with makeMarkDoneAction's executeWithSoup — no
   *  navigation or collapse: the rows stay in place. */
  const executeWithSoup = async (
    entities: EntityData[],
    _soup: EntityActionListState
  ) => {
    await execute(entities);
  };

  return { canExecute: canMarkNotDone, execute, executeWithSoup };
};
