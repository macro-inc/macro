import { toast } from '@core/component/Toast/Toast';
import type { EntityData } from '@entity';
import { entityIsMuted, muteItemForEntity } from '@entity/utils/notification';
import type { NotificationSource } from '@notifications';
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
    const verb = shouldUnmute ? 'Unmuted' : 'Muted';
    const failed = results.filter((r) => r.status === 'rejected').length;
    const succeeded = results.length - failed;
    if (failed === 0) {
      toast.success(
        succeeded > 1
          ? `${verb} notifications for ${succeeded} items`
          : `${verb} notifications`
      );
    } else if (succeeded === 0) {
      toast.failure(
        shouldUnmute
          ? 'Failed to unmute notifications'
          : 'Failed to mute notifications'
      );
    } else {
      toast.failure(
        `${verb} ${succeeded} of ${results.length} items; ${failed} failed`
      );
    }
  };

  const executeWithSoup = async (
    entities: EntityData[],
    _soup: EntityActionListState
  ) => {
    await execute(entities);
  };

  return { canExecute, isMuted, execute, executeWithSoup };
};
