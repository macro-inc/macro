import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { t } from '@app/lib/i18n';
import { MenuGroup, MenuSeparator } from '@core/component/ContextMenu';
import { enableChannelNotificationSettings } from '@core/constant/featureFlags';
import { fireAndForget } from '@core/util/fireAndForget';
import { isMutedItem } from '@entity/utils/notification';
import { NotificationMuteMenu } from '@notifications/components/NotificationMuteMenu';
import { NotificationSettingsMenu } from '@notifications/components/NotificationSettingsMenu';
import { useAvailableSectionChannelsQuery } from '@queries/channel-labels/channel-labels';
import { queryReadyGate } from '@queries/gate';
import { useMutedEntitiesQuery } from '@queries/notification/unsubscribes';
import { type JSX, Show } from 'solid-js';
import { match } from 'ts-pattern';
import type { ChannelSectionKey } from '../../../types';
import { useChannelsRail } from '../ChannelsRailContext';
import { sectionNotificationMenus } from '../hooks/section-notification-menus';
export function SectionMuteMenu(props: { section: ChannelSectionKey }) {
  const rail = useChannelsRail();
  const muted = useMutedEntitiesQuery();
  const channels = useAvailableSectionChannelsQuery(rail.sectionsEnabled);
  const ids = () => {
    if (props.section === 'favorites')
      return rail
        .favorites()
        .filter((favorite) => favorite.entityType === 'channel')
        .map((favorite) => favorite.entityId);
    if (props.section.startsWith('label:'))
      return (
        rail.labels().find((label) => `label:${label.id}` === props.section)
          ?.channelIds ?? []
      );
    if (!queryReadyGate(channels)) return [];
    return (channels.data ?? [])
      .filter((channel) => {
        if (!channel.is_participant) return false;
        if (props.section === 'team_channels')
          return channel.channel_type === 'team';
        if (props.section === 'direct_messages')
          return channel.channel_type === 'direct_message';
        return (
          channel.channel_type !== 'team' &&
          channel.channel_type !== 'direct_message'
        );
      })
      .map((channel) => channel.id);
  };
  const allMuted = () =>
    queryReadyGate(muted) &&
    ids().length > 0 &&
    ids().every((id) =>
      isMutedItem(muted.data ?? [], { item_type: 'channel', item_id: id })
    );
  return (
    <NotificationMuteMenu
      label={t('channelSections.muteAllChannels')}
      unmuteLabel={t('channelSections.unmuteAllChannels')}
      muted={allMuted()}
      disabled={rail.sectionNotificationsDisabled(props.section)}
      onMute={(value) =>
        fireAndForget(rail.muteSection(props.section, value), 'channels-view')
      }
      onSnooze={(until) =>
        fireAndForget(rail.snoozeSection(props.section, until), 'channels-view')
      }
    />
  );
}

/**
 * A section's notification controls after its Mark all as read row: with the
 * settings rollout, its own Mute and Notification Settings in a group of their
 * own ("All channels" has none); otherwise muting its current channels, in the
 * same group as Mark all as read.
 */
export function SectionNotificationControls(props: {
  section: ChannelSectionKey;
  markRead: JSX.Element;
}) {
  const flag = useFeatureFlag(enableChannelNotificationSettings);
  const rail = useChannelsRail();
  const menusFor = sectionNotificationMenus(rail.channelNotifications);
  const name = () =>
    match(props.section)
      .with('favorites', () => t('channelSections.favorites'))
      .with('direct_messages', () => t('channelSections.direct_messages'))
      .with('team_channels', () => t('channelSections.team_channels'))
      .with('channels', () => t('channelSections.allChannels'))
      .otherwise(
        (section) =>
          rail.labels().find((label) => `label:${label.id}` === section)
            ?.name ?? t('channelSections.channels')
      );

  return (
    <Show
      when={flag().enabled}
      fallback={
        <MenuGroup>
          {props.markRead}
          <SectionMuteMenu section={props.section} />
        </MenuGroup>
      }
    >
      <MenuGroup>{props.markRead}</MenuGroup>
      <Show when={menusFor(props.section, name())}>
        {(menus) => (
          <>
            <MenuSeparator />
            <MenuGroup>
              <NotificationMuteMenu {...menus().mute} />
              <NotificationSettingsMenu {...menus().settings} />
            </MenuGroup>
          </>
        )}
      </Show>
    </Show>
  );
}
