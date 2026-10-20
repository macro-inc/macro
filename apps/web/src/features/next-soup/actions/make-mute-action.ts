import { t } from '@app/lib/i18n';
import { toast } from '@core/component/Toast/Toast';
import type { EntityData } from '@entity';
import { entityIsMuted, muteItemForEntity } from '@entity/utils/notification';
import type { NotificationSource } from '@notifications';
import { openSnoozeNotifications } from '@notifications/SnoozeNotificationsDialog';
import {
  useMuteItemMutation,
  useUnmuteItemMutation,
} from '@queries/notification/unsubscribes';
import type { UserUnsubscribe } from '@service-notification/generated/schemas/userUnsubscribe';
import type { EntityActionListState } from './entity-action-context';

type MakeMuteActionOptions = {
  notificationSource: () => NotificationSource;
};

/**
 * Toggle notification mute for an entity.
 *
 * `execute` mutes every entity that is not yet muted; when all of them
 * already are, it unmutes them instead. Channel threads mute the parent
 * channel — that is the notification's primary entity.
 */
export const makeMuteAction = (options: MakeMuteActionOptions) => {
  const muteMutation = useMuteItemMutation();
  const unmuteMutation = useUnmuteItemMutation();

  const snooze = (entities: EntityData[]) => {
    openSnoozeNotifications(
      entities.flatMap((entity) => {
        const item = muteItemForEntity(entity);
        return item ? [item] : [];
      })
    );
  };

  const canExecute = (entity: EntityData): boolean =>
    muteItemForEntity(entity) !== undefined;

  const isMuted = (entity: EntityData): boolean =>
    entityIsMuted(options.notificationSource().mutedEntities(), entity);

  const execute = async (entities: EntityData[]) => {
    // Ignore re-triggers while a toggle is still settling so a rapid
    // double-press can't fire a mute and its own unmute against each other.
    if (muteMutation.isPending || unmuteMutation.isPending) return;

    const muteable = entities.filter(canExecute);
    const shouldUnmute = muteable.length > 0 && muteable.every(isMuted);
    // On mute, skip entities already muted so counts reflect real work.
    const targets = shouldUnmute
      ? muteable
      : muteable.filter((entity) => !isMuted(entity));

    // Several rows (threads in one channel) can share a mute target.
    const items = new Map<string, UserUnsubscribe>();
    for (const entity of targets) {
      const item = muteItemForEntity(entity);
      if (item) items.set(`${item.item_type}:${item.item_id}`, item);
    }
    if (items.size === 0) return;

    const mutation = shouldUnmute ? unmuteMutation : muteMutation;
    const results = await Promise.allSettled(
      [...items.values()].map((item) => mutation.mutateAsync(item))
    );

    // Each mutation rolls its own optimistic change back on failure, so report
    // what actually happened rather than an all-or-nothing result.
    const failed = results.filter((r) => r.status === 'rejected').length;
    const succeeded = results.length - failed;
    if (failed === 0) {
      toast.success(
        succeeded > 1
          ? t(
              shouldUnmute
                ? 'entityActions.toastUnmutedCount'
                : 'entityActions.toastMutedCount',
              { count: succeeded }
            )
          : t(
              shouldUnmute
                ? 'entityActions.toastUnmuted'
                : 'entityActions.toastMuted'
            )
      );
    } else if (succeeded === 0) {
      toast.failure(
        shouldUnmute
          ? t('entityActions.toastUnmuteFailed')
          : t('entityActions.toastMuteFailed')
      );
    } else {
      toast.failure(
        t(
          shouldUnmute
            ? 'entityActions.toastUnmutedSome'
            : 'entityActions.toastMutedSome',
          { succeeded, total: results.length, failed }
        )
      );
    }
  };

  const executeWithSoup = async (
    entities: EntityData[],
    _soup: EntityActionListState
  ) => {
    await execute(entities);
  };

  return { canExecute, isMuted, execute, executeWithSoup, snooze };
};
