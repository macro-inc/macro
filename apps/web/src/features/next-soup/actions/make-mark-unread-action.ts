import { t } from '@app/lib/i18n';
import { toast } from '@core/component/Toast/Toast';
import type { EntityData } from '@entity';
import { useNonPrimaryEmailLinkIdHeader } from '@queries/email/link';
import {
  useMarkThreadAsSeenMutation,
  useMarkThreadAsUnreadMutation,
} from '@queries/email/thread';
import { refetchSoupEntity } from '@queries/soup/cache';
import type { EntityActionListState } from './entity-action-context';

/**
 * Marks read email threads as unread. Rows stay in place — only the soup
 * row's read indicator flips (optimistically via the mutation's onMutate).
 */
export const makeMarkUnreadAction = () => {
  const markUnreadMutation = useMarkThreadAsUnreadMutation();

  const canExecute = (entity: EntityData): boolean =>
    entity.type === 'email' && entity.isRead === true;

  const execute = async (entities: EntityData[]) => {
    const targets = entities.filter(canExecute);
    if (targets.length === 0) return;

    const results = await Promise.allSettled(
      targets.map((entity) =>
        markUnreadMutation.mutateAsync({
          threadId: entity.id,
          linkId: entity.type === 'email' ? entity.linkId : undefined,
        })
      )
    );

    const failed = targets.filter((_, i) => results[i]?.status === 'rejected');
    if (failed.length > 0) {
      toast.failure(t('entityActions.toastMarkUnreadFailed'));
      // Restore the optimistically-flipped rows to the server's state.
      failed.forEach((entity) => refetchSoupEntity(entity.id, 'emailThread'));
      return;
    }

    toast.success(
      targets.length > 1
        ? t('entityActions.toastMarkedUnreadCount', { count: targets.length })
        : t('entityActions.toastMarkedUnread'),
      { duration: 3_000, stack: true, hideOnMobile: true }
    );
  };

  /** Signature parity with the mark-done actions — no navigation or
   *  collapse: the rows stay in place. */
  const executeWithSoup = async (
    entities: EntityData[],
    _soup: EntityActionListState
  ) => {
    await execute(entities);
  };

  return { canExecute, execute, executeWithSoup };
};

/**
 * Marks unread email threads as read via the seen endpoint (same call the
 * thread view fires on open).
 */
export const makeMarkReadAction = () => {
  const markSeenMutation = useMarkThreadAsSeenMutation();
  const toHeaderLinkId = useNonPrimaryEmailLinkIdHeader();

  const canExecute = (entity: EntityData): boolean =>
    entity.type === 'email' && entity.isRead === false;

  const execute = async (entities: EntityData[]) => {
    const targets = entities.filter(canExecute);
    if (targets.length === 0) return;

    const results = await Promise.allSettled(
      targets.map((entity) =>
        markSeenMutation.mutateAsync({
          threadId: entity.id,
          linkId: toHeaderLinkId(
            entity.type === 'email' ? entity.linkId : undefined
          ),
        })
      )
    );

    const failed = targets.filter((_, i) => results[i]?.status === 'rejected');
    if (failed.length > 0) {
      toast.failure(t('entityActions.toastMarkReadFailed'));
      failed.forEach((entity) => refetchSoupEntity(entity.id, 'emailThread'));
      return;
    }

    toast.success(
      targets.length > 1
        ? t('entityActions.toastMarkedReadCount', { count: targets.length })
        : t('entityActions.toastMarkedRead'),
      { duration: 3_000, stack: true, hideOnMobile: true }
    );
  };

  /** Signature parity with the mark-done actions — no navigation or
   *  collapse: the rows stay in place. */
  const executeWithSoup = async (
    entities: EntityData[],
    _soup: EntityActionListState
  ) => {
    await execute(entities);
  };

  return { canExecute, execute, executeWithSoup };
};
