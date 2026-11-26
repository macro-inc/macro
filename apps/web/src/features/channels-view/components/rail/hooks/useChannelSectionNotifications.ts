import { t } from '@app/lib/i18n';
import { toast } from '@core/component/Toast/Toast';
import { useChannelDirectory } from '@core/context/channels';
import { useUserId } from '@core/context/user';
import { Telemetry } from '@macro-inc/observability';
import { markChannelsAsRead } from '@notifications/notification-helpers';
import { openSnoozeNotifications } from '@notifications/SnoozeNotificationsDialog';
import { queryAccountSession } from '@queries/auth/account-scope';
import { useBulkNotificationPreferencesMutation } from '@queries/notification/unsubscribes';
import type { ChannelLabel } from '@service-storage/generated/schemas/channelLabel';
import type { Favorite } from '@service-storage/generated/schemas/favorite';
import {
  type Accessor,
  createEffect,
  createSignal,
  type Owner,
  on,
  onCleanup,
} from 'solid-js';
import { channelGroupIds } from '../../../queries';
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
  const directory = useChannelDirectory();
  const notificationPreferences = useBulkNotificationPreferencesMutation();
  const [pending, setPending] = createSignal<{ actorId: string }>();
  // Each action's read of the section's members, ended when the rail goes:
  // a full read pages every joined channel.
  const reads = new Set<AbortController>();
  let disposed = false;

  onCleanup(() => {
    disposed = true;
    for (const read of reads) read.abort();
  });
  // A new sign-in, even to the same account, ends them too: the rail can
  // outlive it, and a read under way pages on with the new credentials.
  createEffect(
    on(
      queryAccountSession,
      () => {
        for (const read of reads) read.abort();
      },
      { defer: true }
    )
  );

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
      return Telemetry.span('channels.section.members', async () =>
        channelGroupIds(section, [], await directory.readComplete(signal))
      );
    }

    return [...new Set(labelFor(section)?.channelIds ?? [])];
  };

  const updateSectionNotifications = async (
    section: ChannelSectionKey,
    action: 'mute' | 'unmute' | 'snooze' | 'read',
    until?: Date
  ) => {
    const actorId = userId();
    const owner = options.dialogOwner();

    if (!actorId || !owner || sectionNotificationsDisabled(section)) {
      return;
    }

    const request = { actorId };
    // A new sign-in, even to the same account, ends the action: the rail
    // can outlive it.
    const session = queryAccountSession();

    const isCurrent = () =>
      !disposed &&
      options.enabled() &&
      userId() === actorId &&
      queryAccountSession() === session &&
      options.dialogOwner() === owner;

    setPending(request);
    const read = new AbortController();
    reads.add(read);

    try {
      await Telemetry.span('channels.section.notifications', async (span) => {
        span.setAttr('section.id', section);
        span.setAttr('notification.action', action);

        const ids = channelIdsFor(section, read.signal);
        const channelIds = Array.isArray(ids) ? ids : await ids;

        if (!isCurrent() || channelIds.length === 0) {
          return;
        }

        span.setAttr('notification.count', channelIds.length);

        if (action === 'read') {
          await markChannelsAsRead(channelIds);
          return;
        }

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
      // The rail went, or the viewer signed in again, while the members were
      // read: nothing is left to tell.
      if (read.signal.aborted) return;
      if (isCurrent()) {
        toast.failure(t('channelSections.notificationsFailed'));
      }

      throw error;
    } finally {
      reads.delete(read);
      setPending((current) => (current === request ? undefined : current));
    }
  };

  return {
    sectionNotificationsDisabled,
    markSectionRead: (section: ChannelSectionKey) =>
      updateSectionNotifications(section, 'read'),
    muteSection: (section: ChannelSectionKey, muted: boolean) =>
      updateSectionNotifications(section, muted ? 'mute' : 'unmute'),
    snoozeSection: (section: ChannelSectionKey, until?: Date) =>
      updateSectionNotifications(section, 'snooze', until),
  };
}
