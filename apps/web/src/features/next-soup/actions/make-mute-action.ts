import { t } from '@app/lib/i18n';
import { toast } from '@core/component/Toast/Toast';
import { useUserId } from '@core/context/user';
import { fireAndForget } from '@core/util/fireAndForget';
import type { EntityData } from '@entity';
import { entityIsMuted, muteItemForEntity } from '@entity/utils/notification';
import type { NotificationSource } from '@notifications';
import type { NotificationMuteMenuProps } from '@notifications/components/NotificationMuteMenu';
import { openSnoozeNotifications } from '@notifications/SnoozeNotificationsDialog';
import {
  useBulkNotificationPreferencesMutation,
  useMuteItemMutation,
  useUnmuteItemMutation,
} from '@queries/notification/unsubscribes';
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

  const userId = useUserId();
  const bulkMutation = useBulkNotificationPreferencesMutation();
  const itemsFor = (entities: EntityData[]) => [
    ...new Map(
      entities.flatMap((entity) => {
        const item = muteItemForEntity(entity);
        return item
          ? [[`${item.item_type}:${item.item_id}`, item] as const]
          : [];
      })
    ).values(),
  ];

  const snooze = (entities: EntityData[], until?: Date) => {
    const items = itemsFor(entities);
    if (!until) {
      openSnoozeNotifications(items);
      return;
    }
    const actorId = userId();
    if (!actorId || bulkMutation.isPending) return;
    const save = async () => {
      const result = await bulkMutation.mutateAsync({
        actorId,
        items,
        muted: true,
        snoozedUntil: until.toISOString(),
      });
      if (userId() === actorId && result.failed.length) {
        toast.failure(t('channelSections.notificationsFailed'));
      }
    };
    fireAndForget(save(), 'entity-actions');
  };

  const canExecute = (entity: EntityData): boolean =>
    muteItemForEntity(entity) !== undefined;

  const isMuted = (entity: EntityData): boolean =>
    entityIsMuted(options.notificationSource().mutedEntities(), entity);

  const setMuted = async (
    entities: EntityData[],
    muted: boolean,
    skipMuted = false
  ) => {
    // Ignore re-triggers while a toggle is still settling so a rapid
    // double-press can't fire a mute and its own unmute against each other.
    if (
      muteMutation.isPending ||
      unmuteMutation.isPending ||
      bulkMutation.isPending
    )
      return;

    const muteable = entities.filter(canExecute);
    const shouldUnmute = !muted;
    // Toggles preserve existing mutes; an explicit menu choice applies to all targets.
    const targets =
      shouldUnmute || !skipMuted
        ? muteable
        : muteable.filter((entity) => !isMuted(entity));
    const items = itemsFor(targets);
    if (items.length === 0) return;

    const mutation = shouldUnmute ? unmuteMutation : muteMutation;
    const results = await Promise.allSettled(
      items.map((item) => mutation.mutateAsync(item))
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
          { succeeded, count: results.length, failed }
        )
      );
    }
  };

  const execute = async (entities: EntityData[]) => {
    const muteable = entities.filter(canExecute);
    await setMuted(muteable, !muteable.every(isMuted), true);
  };

  const menu = (entities: EntityData[]): NotificationMuteMenuProps => ({
    label: t('entityActions.muteNotifications'),
    unmuteLabel: t('entityActions.unmuteNotifications'),
    muted: entities.length > 0 && entities.every(isMuted),
    disabled:
      muteMutation.isPending ||
      unmuteMutation.isPending ||
      bulkMutation.isPending,
    onMute: (muted) =>
      fireAndForget(setMuted(entities, muted), 'entity-actions'),
    onSnooze: (until) => snooze(entities, until),
  });
  const executeWithSoup = async (
    entities: EntityData[],
    _soup: EntityActionListState
  ) => {
    await execute(entities);
  };

  return { canExecute, isMuted, execute, executeWithSoup, snooze, menu };
};
