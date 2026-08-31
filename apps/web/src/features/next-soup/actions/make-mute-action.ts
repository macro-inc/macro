import { toast } from '@core/component/Toast/Toast';
import type { EntityData } from '@entity';
import {
  entityIsMuted,
  type MuteItem,
  muteItemForEntity,
} from '@entity/utils/notification';
import type { NotificationSource } from '@notifications';
import {
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

  const canExecute = (entity: EntityData): boolean =>
    muteItemForEntity(entity) !== undefined;

  const isMuted = (entity: EntityData): boolean =>
    entityIsMuted(options.notificationSource().mutedEntities(), entity);

  const execute = async (entities: EntityData[]) => {
    const muteable = entities.filter(canExecute);
    if (muteable.length === 0) return;
    // Ignore re-triggers while a toggle is still settling so a rapid
    // double-press can't fire a mute and its own unmute against each other.
    if (muteMutation.isPending || unmuteMutation.isPending) return;

    const shouldUnmute = muteable.every((entity) => isMuted(entity));
    const verb = shouldUnmute ? 'Unmuted' : 'Muted';

    const targets = shouldUnmute
      ? muteable
      : muteable.filter((entity) => !isMuted(entity));
    if (targets.length === 0) return;

    // Several rows (threads in one channel) can share a mute target.
    const unique = new Map<string, MuteItem>();
    for (const entity of targets) {
      const item = muteItemForEntity(entity);
      if (!item) continue;
      unique.set(`${item.item_type}:${item.item_id}`, item);
    }
    if (unique.size === 0) return;

    const results = await Promise.allSettled(
      [...unique.values()].map((item) =>
        shouldUnmute
          ? unmuteMutation.mutateAsync(item)
          : muteMutation.mutateAsync(item)
      )
    );

    const failed = results.filter(
      (result) => result.status === 'rejected'
    ).length;
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
