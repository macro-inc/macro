import { t } from '@app/lib/i18n';
import { fireAndForget } from '@core/util/fireAndForget';
import type { EntityData } from '@entity';
import type { NotificationSettingsMenuProps } from '@notifications/components/NotificationSettingsMenu';
import type { ChannelNotificationSettingsState } from '@notifications/primitives/create-channel-notification-settings';

/**
 * Notification Settings for one channel: All messages, Messages involving
 * me, Custom or Nothing. Choosing one sets every kind on the channel itself;
 * Use section settings hands them back to its sections.
 */
export function notificationSettingsMenuFor(
  settings: ChannelNotificationSettingsState,
  entities: EntityData[]
): NotificationSettingsMenuProps | undefined {
  const [entity] = entities;
  if (
    !settings.enabled() ||
    entities.length !== 1 ||
    entity?.type !== 'channel'
  ) {
    return undefined;
  }

  const view = settings.channel(entity.id, entity.channelType);
  const run = (write: Promise<unknown>) =>
    fireAndForget(write, 'entity-actions');
  return {
    preset: view.preset,
    enabled: view.enabled,
    hint: view.following,
    targetName: entity.name || t('channelSections.unnamedChannel'),
    disabled: settings.pending(),
    onPreset: (preset) => run(settings.setChannelPreset(entity.id, preset)),
    onSetKinds: (kinds) => run(settings.setChannelKinds(entity.id, kinds)),
    onFollowSections:
      view.hasOwnChoices && view.deciding.length > 0
        ? () => run(settings.followSectionSettings(entity.id))
        : undefined,
  };
}
