import { formatLocale, t } from '@app/lib/i18n';
import { fireAndForget } from '@core/util/fireAndForget';
import type { NotificationMuteMenuProps } from '@notifications/components/NotificationMuteMenu';
import type { NotificationSettingsMenuProps } from '@notifications/components/NotificationSettingsMenu';
import { formatSnoozeDeadline } from '@notifications/core/snooze';
import type { ChannelNotificationSettingsState } from '@notifications/primitives/create-channel-notification-settings';
import { openSectionSnooze } from '@notifications/SnoozeNotificationsDialog';
import type { ChannelSectionKey } from '../../../types';

export type SectionNotificationMenus = {
  mute: NotificationMuteMenuProps;
  settings: NotificationSettingsMenuProps;
};

/**
 * A Chat section's own Mute and Notification Settings, stored on the section
 * so they also cover channels added to it later. "All channels" has neither.
 */
export function sectionNotificationMenus(
  settings: ChannelNotificationSettingsState
) {
  const run = (write: Promise<unknown>) =>
    fireAndForget(write, 'channels-view');

  return (
    section: ChannelSectionKey,
    name: string
  ): SectionNotificationMenus | undefined => {
    if (!settings.enabled() || section === 'channels') return undefined;

    const view = settings.section(section);
    const mute = view.muted ? view.mute : undefined;
    return {
      mute: {
        label: t('channelSections.mute'),
        unmuteLabel: t('channelSections.unmute'),
        muted: view.muted,
        mutedHint:
          mute?.state === 'snoozed'
            ? t('channelSections.mutedUntil', {
                time: formatSnoozeDeadline(
                  new Date(mute.until),
                  formatLocale()
                ),
              })
            : undefined,
        disabled: settings.pending(),
        onMute: (muted) =>
          run(
            settings.setSectionMute(section, {
              state: muted ? 'muted' : 'unmuted',
            })
          ),
        onSnooze: (until) => {
          if (until) {
            run(
              settings.setSectionMute(section, {
                state: 'snoozed',
                until: until.toISOString(),
              })
            );
            return;
          }
          openSectionSnooze((deadline) =>
            settings.setSectionMute(section, {
              state: 'snoozed',
              until: deadline,
            })
          );
        },
      },
      settings: {
        preset: view.preset,
        enabled: view.enabled,
        targetName: name,
        disabled: settings.pending(),
        onPreset: (preset) => run(settings.setSectionPreset(section, preset)),
        onSetKinds: (kinds) => run(settings.setSectionKinds(section, kinds)),
      },
    };
  };
}
