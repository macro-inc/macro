import { formatLocale, t } from '@app/lib/i18n';
import { toast } from '@core/component/Toast/Toast';
import { useUserId } from '@core/context/user';
import { fireAndForget } from '@core/util/fireAndForget';
import type { EntityData } from '@entity';
import {
  entityIsMentionsOnly,
  entityIsMuted,
  muteItemForEntity,
} from '@entity/utils/notification';
import type { NotificationSource } from '@notifications';
import type { NotificationMuteMenuProps } from '@notifications/components/NotificationMuteMenu';
import { formatSnoozeDeadline } from '@notifications/core/snooze';
import type { ChannelNotificationSettingsState } from '@notifications/primitives/create-channel-notification-settings';
import { openSnoozeNotifications } from '@notifications/SnoozeNotificationsDialog';
import {
  useBulkNotificationPreferencesMutation,
  useMuteItemMutation,
  useUnmuteItemMutation,
} from '@queries/notification/unsubscribes';
import { match } from 'ts-pattern';
import type { EntityActionListState } from './entity-action-context';

type MakeMuteActionOptions = {
  notificationSource: () => NotificationSource;
  /**
   * With the channel Notification Settings rollout, Mute also covers a
   * channel its sections mute, and Only @mentions becomes one of those
   * settings instead of a mute choice.
   */
  channelSettings?: ChannelNotificationSettingsState;
};

/**
 * Toggle notification mute for an entity.
 *
 * `execute` mutes every entity that is not yet muted; when all of them
 * already are, it unmutes them instead. Channel threads mute the parent
 * channel — that is the notification's primary entity.
 *
 * Channels other than one-to-one direct messages can also notify for direct
 * @mentions only; `menu` offers that when every target is such a channel.
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

  const settingsEnabled = () => options.channelSettings?.enabled() === true;

  /** Any mute or settings write still settling; a re-trigger could undo it. */
  const writesPending = () =>
    muteMutation.isPending ||
    unmuteMutation.isPending ||
    bulkMutation.isPending ||
    options.channelSettings?.pending() === true;

  const isOwnMuted = (entity: EntityData): boolean =>
    entityIsMuted(options.notificationSource().mutedEntities(), entity);

  /** The channel whose settings apply: a thread or message takes its channel's. */
  const channelOf = (
    entity: EntityData
  ): { id: string; channelType: string | undefined } | undefined =>
    match(entity)
      .with({ type: 'channel' }, (channel) => ({
        id: channel.id,
        channelType: channel.channelType,
      }))
      .with(
        { type: 'channel_message' },
        { type: 'channel_thread' },
        (message) => ({
          id: message.channelId,
          channelType: message.channelType,
        })
      )
      .otherwise(() => undefined);

  /** Muted by the channel's sections, and not kept notifying by the channel. */
  const isSectionMuted = (entity: EntityData): boolean => {
    const settings = options.channelSettings;
    const channel = channelOf(entity);
    if (!settings?.enabled() || !channel) return false;
    return settings.channel(channel.id, channel.channelType).mutedBySections;
  };

  const isMuted = (entity: EntityData): boolean =>
    isOwnMuted(entity) || isSectionMuted(entity);

  /**
   * Unmuting a channel its sections mute keeps that channel notifying inside
   * them; its own mute, if any, is removed separately. Returns how many
   * were saved.
   */
  const keepNotifyingInMutedSections = async (targets: EntityData[]) => {
    const settings = options.channelSettings;
    const sectionMuted = targets.filter(isSectionMuted);
    if (!settings || sectionMuted.length === 0) return 0;
    const channelIds = new Set(
      sectionMuted.flatMap((entity) => channelOf(entity)?.id ?? [])
    );
    const saved = await Promise.all(
      [...channelIds].map((channelId) =>
        settings.setOverridesSectionMute(channelId, true)
      )
    );
    return saved.filter(Boolean).length;
  };

  const setMuted = async (
    entities: EntityData[],
    muted: boolean,
    skipMuted = false
  ) => {
    // Ignore re-triggers while a toggle is still settling so a rapid
    // double-press can't fire a mute and its own unmute against each other.
    if (writesPending()) return;

    const muteable = entities.filter(canExecute);
    const shouldUnmute = !muted;
    // Toggles preserve existing mutes; an explicit menu choice applies to all targets.
    const targets =
      shouldUnmute || !skipMuted
        ? muteable
        : muteable.filter((entity) => !isMuted(entity));
    const sectionMuted = shouldUnmute
      ? await keepNotifyingInMutedSections(targets)
      : 0;

    const items = itemsFor(
      shouldUnmute && settingsEnabled() ? targets.filter(isOwnMuted) : targets
    );
    if (items.length === 0) {
      if (sectionMuted > 0) toast.success(t('entityActions.toastUnmuted'));
      return;
    }

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

  const supportsMentionsOnly = (entity: EntityData): boolean =>
    entity.type === 'channel' && entity.channelType !== 'direct_message';

  const isMentionsOnly = (entity: EntityData): boolean =>
    entityIsMentionsOnly(options.notificationSource().mutedEntities(), entity);

  /** Turning it off returns the channels to notifying for every message. */
  const setMentionsOnly = async (entities: EntityData[], active: boolean) => {
    if (
      muteMutation.isPending ||
      unmuteMutation.isPending ||
      bulkMutation.isPending
    )
      return;

    const items = itemsFor(entities.filter(supportsMentionsOnly));
    if (items.length === 0) return;

    const results = await Promise.allSettled(
      items.map((item) =>
        active
          ? muteMutation.mutateAsync({ ...item, mentions_only: true })
          : unmuteMutation.mutateAsync(item)
      )
    );
    if (results.some((result) => result.status === 'rejected')) {
      toast.failure(t('entityActions.toastNotificationLevelFailed'));
      return;
    }
    toast.success(
      t(
        active
          ? 'entityActions.toastMentionsOnly'
          : 'entityActions.toastAllMessages'
      )
    );
  };

  const execute = async (entities: EntityData[]) => {
    const muteable = entities.filter(canExecute);
    await setMuted(muteable, !muteable.every(isMuted), true);
  };

  /** "Until 3:00 PM" for a snooze, "Muted by Work" for section mute. */
  const mutedHint = (entities: EntityData[]): string | undefined => {
    const [entity] = entities;
    if (!settingsEnabled() || entities.length !== 1 || !entity)
      return undefined;

    if (isOwnMuted(entity)) {
      const item = muteItemForEntity(entity);
      const until = options
        .notificationSource()
        .mutedEntities()
        .find(
          (entry) =>
            entry.item_id === item?.item_id &&
            entry.item_type === item?.item_type
        )?.snoozed_until;
      return until
        ? t('channelSections.mutedUntil', {
            time: formatSnoozeDeadline(new Date(until), formatLocale()),
          })
        : undefined;
    }

    const settings = options.channelSettings;
    const channel = channelOf(entity);
    if (settings && channel && isSectionMuted(entity)) {
      const view = settings.channel(channel.id, channel.channelType);
      return t('channelSections.mutedBySection', { name: view.sectionNames });
    }
    return undefined;
  };

  const menu = (entities: EntityData[]): NotificationMuteMenuProps => ({
    label: settingsEnabled()
      ? t('channelSections.mute')
      : t('entityActions.muteNotifications'),
    unmuteLabel: settingsEnabled()
      ? t('channelSections.unmute')
      : t('entityActions.unmuteNotifications'),
    mutedHint: mutedHint(entities),
    muted: entities.length > 0 && entities.every(isMuted),
    disabled: writesPending(),
    onMute: (muted) =>
      fireAndForget(setMuted(entities, muted), 'entity-actions'),
    onSnooze: (until) => snooze(entities, until),
    mentionsOnly:
      !settingsEnabled() &&
      entities.length > 0 &&
      entities.every(supportsMentionsOnly)
        ? {
            active: entities.every(isMentionsOnly),
            onChange: (active) =>
              fireAndForget(
                setMentionsOnly(entities, active),
                'entity-actions'
              ),
          }
        : undefined,
  });
  const executeWithSoup = async (
    entities: EntityData[],
    _soup: EntityActionListState
  ) => {
    await execute(entities);
  };

  return { canExecute, isMuted, execute, executeWithSoup, snooze, menu };
};
