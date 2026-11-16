import { t } from '@app/lib/i18n';
import { fireAndForget } from '@core/util/fireAndForget';
import { isMutedItem } from '@entity/utils/notification';
import { NotificationMuteMenu } from '@notifications/components/NotificationMuteMenu';
import { useAvailableSectionChannelsQuery } from '@queries/channel-labels/channel-labels';
import { queryReadyGate } from '@queries/gate';
import { useMutedEntitiesQuery } from '@queries/notification/unsubscribes';
import type { ChannelSectionKey } from '../../../types';
import { useChannelsRail } from '../ChannelsRailContext';
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
