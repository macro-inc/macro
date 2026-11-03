import { t } from '@app/lib/i18n';
import { useGlobalNotificationSource } from '@components/app/GlobalAppState';
import { toast } from '@core/component/Toast/Toast';
import { useUserId } from '@core/context/user';
import { Telemetry } from '@macro-inc/observability';
import { openSnoozeNotifications } from '@notifications/SnoozeNotificationsDialog';
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
  const notificationSource = useGlobalNotificationSource();
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
      // Only All channels excludes custom-section assignments.
      const excludedIds =
        section === 'channels'
          ? options.labels().flatMap((label) => label.channelIds)
          : [];

      return Telemetry.span('channels.section.members', () =>
        fetchChannelGroupIds(section, excludedIds, signal)
      );
    }

    return [...new Set(labelFor(section)?.channelIds ?? [])];
  };

  const updateSectionNotifications = async (
    section: ChannelSectionKey,
    action: 'mute' | 'unmute' | 'snooze'
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

        if (action === 'snooze') {
          openSnoozeNotifications(
            channelIds.map((id) => ({ item_type: 'channel', item_id: id })),
            { owner }
          );
          return;
        }

        const muted = action === 'mute';
        const results = await Promise.allSettled(
          channelIds.map((id) =>
            span.span('channels.section.notification.update', async (child) => {
              child.setAttr('channel.id', id);

              if (muted) {
                await notificationSource.muteEntity({ type: 'channel', id });
              } else {
                await notificationSource.unmuteEntity({ type: 'channel', id });
              }
            })
          )
        );
        const failed = results.filter(
          (result) => result.status === 'rejected'
        ).length;
        const succeeded = results.length - failed;

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
              { succeeded, count: results.length, failed }
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
    snoozeSection: (section: ChannelSectionKey) =>
      updateSectionNotifications(section, 'snooze'),
  };
}
