import { t } from '@app/lib/i18n';
import { fireAndForget } from '@core/util/fireAndForget';
import type { EntityData } from '@entity';
import type { NotificationSettingsMenuProps } from '@notifications/components/NotificationSettingsMenu';
import { presetSummary } from '@notifications/components/notification-settings-labels';
import type { ChannelNotificationSettingsState } from '@notifications/primitives/create-channel-notification-settings';

/**
 * Notification Settings for one channel: All messages, Messages involving
 * me, Custom or Nothing. Choosing one gives the channel its own setting for
 * every kind; Use section default hands them all back to its sections.
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
  const inSections = view.sectionNames !== '';
  const inherited =
    inSections && !view.hasOwnSettings
      ? t('channelSections.inheritedFrom', { names: view.sectionNames })
      : undefined;
  return {
    preset: view.preset,
    enabled: view.enabled,
    hint: inherited,
    source: view.hasOwnSettings
      ? t('channelSections.settingsFromChannel')
      : inherited,
    targetName: entity.name || t('channelSections.unnamedChannel'),
    disabled: settings.pending(),
    onPreset: (preset) => run(settings.setChannelPreset(entity.id, preset)),
    onSetKinds: (kinds) => run(settings.setChannelKinds(entity.id, kinds)),
    sectionDefault:
      view.hasOwnSettings && inSections
        ? {
            description: t('channelSections.sectionDefaultDescription', {
              preset: presetSummary(view.inheritedPreset),
              names: view.sectionNames,
            }),
            onSelect: () => run(settings.followSectionSettings(entity.id)),
          }
        : undefined,
  };
}
