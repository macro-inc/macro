import { t } from '@app/lib/i18n';
import type { ChannelNotificationKind } from '@service-notification/generated/schemas/channelNotificationKind';
import { match } from 'ts-pattern';
import type { NotificationPreset } from '../core/channel-notification-settings';

export function presetLabel(preset: NotificationPreset) {
  return match(preset)
    .with('all', () => t('channelSections.notifyAll'))
    .with('involving', () => t('channelSections.notifyInvolving'))
    .with('custom', () => t('channelSections.notifyCustom'))
    .with('nothing', () => t('channelSections.notifyNothing'))
    .exhaustive();
}

/** The preset's name where it summarizes the current setting. */
export function presetSummary(preset: NotificationPreset) {
  return preset === 'custom'
    ? t('channelSections.notifyCustomShort')
    : presetLabel(preset);
}

export function notificationKindLabel(kind: ChannelNotificationKind) {
  return match(kind)
    .with('channel_message_send', () =>
      t('channelSections.kindTopLevelMessages')
    )
    .with('channel_message_reply', () => t('channelSections.kindThreadReplies'))
    .with('channel_mention', () => t('channelSections.kindMentions'))
    .with('channel_message_reaction', () => t('channelSections.kindReactions'))
    .with('call_started', () => t('channelSections.kindCalls'))
    .with('channel_access_requested', () =>
      t('channelSections.kindJoinRequests')
    )
    .exhaustive();
}
