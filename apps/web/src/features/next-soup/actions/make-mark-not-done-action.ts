import {
  applyEntitiesNotDoneOptimistic,
  executeMarkEntitiesUndone,
  resolveMarkEntitiesDoneVariables,
} from '@app/features/next-soup/utils';
import { t } from '@app/lib/i18n';
import { toast } from '@core/component/Toast/Toast';
import {
  enableGraphqlSoup,
  isFeatureEnabled,
} from '@core/constant/featureFlags';
import type { EntityData } from '@entity';
import type { NotificationSource } from '@notifications';
import type { EmailArchiveDisposition } from '@queries/email/integration';
import { threadCanBeMarkedNotDone } from '@queries/email/thread';
import { fetchDoneNotificationIdsByEventItemIds } from '@queries/notification/user-notifications';
import { invalidateAllSoup, refetchSoupEntity } from '@queries/soup/cache';
import type { EntityActionListState } from './entity-action-context';

type MakeMarkNotDoneOptions = {
  notificationSource: () => NotificationSource;
};

/** Preserve the legacy REST batch, notification ordering and reconciliation. */
async function unarchiveRestTargets(
  targets: EntityData[],
  source: NotificationSource
) {
  const { emailIds, notificationIds } = resolveMarkEntitiesDoneVariables({
    entities: targets,
    notificationSource: source,
  });
  const optimistic = applyEntitiesNotDoneOptimistic({
    emailIds,
    notificationIds,
  });
  try {
    const serverNotificationIds =
      await fetchDoneNotificationIdsByEventItemIds(emailIds);
    const disposition = await executeMarkEntitiesUndone({
      emailIds,
      notificationIds: [
        ...new Set([...notificationIds, ...serverNotificationIds]),
      ],
    });
    toast.success(
      targets.length > 1
        ? t('entityActions.toastMarkedNotDoneCount', { count: targets.length })
        : t('entityActions.toastMarkedNotDone'),
      { duration: 3_000, stack: true, hideOnMobile: true }
    );
    if (disposition !== 'queued') {
      await Promise.all(
        emailIds.map((id) => refetchSoupEntity(id, 'emailThread'))
      );
      invalidateAllSoup();
    }
    return disposition;
  } catch (err) {
    optimistic.rollback();
    toast.failure(t('entityActions.toastMarkNotDoneFailed'));
    throw err;
  }
}

/** Each GraphQL email owns its optimistic state; rejected siblings cannot undo it. */
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
 * notifications. GraphQL validates unarchive
 * eligibility on the server. Each thread settles independently, including
 * queued writes; only a completely failed email selection rejects the action.
 */
export const makeMarkNotDoneAction = (options: MakeMarkNotDoneOptions) => {
  const canExecute = (entity: EntityData): boolean =>
    entity.type === 'email' && entity.done === true;

  const execute = async (entities: EntityData[]) => {
    const graphql = isFeatureEnabled(enableGraphqlSoup);
    const doneEmails = entities.filter(
      (e) => e.type === 'email' && e.done === true
    );
    // GraphQL owns per-thread transactions: snapshot identities before awaiting
    // and deduplicate group occurrences. Keep REST's existing input flow intact.
    const candidates = graphql
      ? [
          ...new Map(
            doneEmails.map((entity) => [entity.id, { ...entity }] as const)
          ).values(),
        ]
      : doneEmails;
    if (candidates.length === 0) return;

    // REST may rule out sent-only threads up front. GraphQL leaves eligibility
    // to the server; the per-thread transactions below isolate those rejections.
    const eligibility = await Promise.all(
      candidates.map((entity) => threadCanBeMarkedNotDone(entity.id))
    );
    const targets = candidates.filter((_, i) => eligibility[i]);

    if (targets.length === 0) {
      toast.alert(
        candidates.length > 1
          ? t('entityActions.toastThreadsStayDone')
          : t('entityActions.toastThreadStaysDone'),
        { duration: 4_000 }
      );
      return;
    }

    const source = options.notificationSource();
    if (!graphql) return unarchiveRestTargets(targets, source);
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
    // The GraphQL mutation/queue owns revalidation. A follow-up REST Soup read
    // can return replica-stale archive state after accepted rows have settled,
    // including when a sibling failed. Do not feed it over those accepted rows.
    const message =
      failedCount > 0
        ? t('entityActions.toastMarkedNotDonePartial', {
            accepted: accepted.length,
            total: targets.length,
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

  return { canExecute, execute, executeWithSoup };
};
