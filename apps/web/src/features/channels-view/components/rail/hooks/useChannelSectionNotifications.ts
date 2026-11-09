import { t } from '@app/lib/i18n';
import { toast } from '@core/component/Toast/Toast';
import { useUserId } from '@core/context/user';
import { Telemetry } from '@macro-inc/observability';
import { openSnoozeNotifications } from '@notifications/SnoozeNotificationsDialog';
import { useBulkNotificationPreferencesMutation } from '@queries/notification/unsubscribes';
import type { ChannelLabel } from '@service-storage/generated/schemas/channelLabel';
import type { Favorite } from '@service-storage/generated/schemas/favorite';
import { type Accessor, createSignal, type Owner, onCleanup } from 'solid-js';
import { fetchChannelGroupIds } from '../../../queries';
import type { ChannelSectionKey } from '../../../types';

type SectionNotificationOptions = {
  enabled: Accessor<boolean>;
  labelsAvailable: Accessor<boolean>;
  labels: Accessor<readonly ChannelLabel[]>;
  favorites: Accessor<readonly Favorite[]>;
  dialogOwner: Accessor<Owner | null | undefined>;
};

export function useChannelSectionNotifications(
  options: SectionNotificationOptions
) {
  const userId = useUserId();
  const notificationPreferences = useBulkNotificationPreferencesMutation();
  const [pending, setPending] = createSignal<{ actorId: string }>();
  const requests = new Set<AbortController>();
  let disposed = false;

  onCleanup(() => {
    disposed = true;

    for (const request of requests) {
      request.abort();
    }
  });

  const favoriteIds = () =>
    options
      .favorites()
      .filter((favorite) => favorite.entityType === 'channel')
      .map((favorite) => favorite.entityId);

  const labelFor = (section: ChannelSectionKey) =>
    options.labels().find((label) => section === `label:${label.id}`);

  const sectionNotificationsDisabled = (section: ChannelSectionKey) => {
    if (
      disposed ||
      !options.enabled() ||
      !userId() ||
      pending()?.actorId === userId()
    ) {
      return true;
    }

    if (section === 'favorites') {
      return favoriteIds().length === 0;
    }

    if (!options.labelsAvailable()) {
      return true;
    }

    if (section.startsWith('label:')) {
      return !labelFor(section)?.channelIds.length;
    }

    return false;
  };

  const channelIdsFor = (
    section: ChannelSectionKey,
    signal: AbortSignal
  ): string[] | Promise<string[]> => {
    if (section === 'favorites') {
      return [...new Set(favoriteIds())];
    }

    if (
      section === 'channels' ||
      section === 'team_channels' ||
      section === 'direct_messages'
    ) {
      return Telemetry.span('channels.section.members', () =>
        fetchChannelGroupIds(section, [], signal)
      );
    }

    return [...new Set(labelFor(section)?.channelIds ?? [])];
  };

  const updateSectionNotifications = async (
    section: ChannelSectionKey,
    action: 'mute' | 'unmute' | 'snooze',
    until?: Date
  ) => {
    const actorId = userId();
    const owner = options.dialogOwner();

    if (!actorId || !owner || sectionNotificationsDisabled(section)) {
      return;
    }

    const request = { actorId };
    const controller = new AbortController();

    const isCurrent = () =>
      !disposed &&
      options.enabled() &&
      userId() === actorId &&
      options.dialogOwner() === owner;

    setPending(request);
    requests.add(controller);

    try {
      await Telemetry.span('channels.section.notifications', async (span) => {
        span.setAttr('section.id', section);
        span.setAttr('notification.action', action);

        const ids = channelIdsFor(section, controller.signal);
        const channelIds = Array.isArray(ids) ? ids : await ids;

        if (!isCurrent() || channelIds.length === 0) {
          return;
        }

        span.setAttr('channel.ids', channelIds);
        span.setAttr('notification.count', channelIds.length);

        if (action === 'snooze' && !until) {
          openSnoozeNotifications(
            channelIds.map((id) => ({ item_type: 'channel', item_id: id })),
            { owner }
          );
          return;
        }

        const muted = action !== 'unmute';
        const result = await notificationPreferences.mutateAsync({
          actorId,
          items: channelIds.map((id) => ({
            item_type: 'channel',
            item_id: id,
          })),
          muted,
          snoozedUntil: until?.toISOString(),
        });
        const failed = result.failed.length;
        const succeeded = result.succeeded.length;

        span.setAttr('notification.failed_count', failed);

        if (failed > 0) {
          span.error('Some channel notification updates failed');
        }

        if (!isCurrent()) {
          return;
        }

        if (failed > 0) {
          toast.failure(
            t(
              muted
                ? 'entityActions.toastMutedSome'
                : 'entityActions.toastUnmutedSome',
              { succeeded, count: channelIds.length, failed }
            )
          );
          return;
        }

        toast.success(
          t(
            muted
              ? 'entityActions.toastMutedCount'
              : 'entityActions.toastUnmutedCount',
            { count: succeeded }
          )
        );
      });
    } catch (error) {
      if (isCurrent()) {
        toast.failure(t('channelSections.notificationsFailed'));
      }

      throw error;
    } finally {
      requests.delete(controller);
      setPending((current) => (current === request ? undefined : current));
    }
  };

  return {
    sectionNotificationsDisabled,
    muteSection: (section: ChannelSectionKey, muted: boolean) =>
      updateSectionNotifications(section, muted ? 'mute' : 'unmute'),
    snoozeSection: (section: ChannelSectionKey, until?: Date) =>
      updateSectionNotifications(section, 'snooze', until),
  };
}
