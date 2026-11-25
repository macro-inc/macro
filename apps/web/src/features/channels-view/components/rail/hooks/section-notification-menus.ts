import { formatLocale, t } from '@app/lib/i18n';
import { fireAndForget } from '@core/util/fireAndForget';
import type { NotificationMuteMenuProps } from '@notifications/components/NotificationMuteMenu';
import type { NotificationSettingsMenuProps } from '@notifications/components/NotificationSettingsMenu';
import {
  type NotificationSectionKey,
  PRESET_KINDS,
  type SectionChange,
} from '@notifications/core/channel-notification-settings';
import { formatSnoozeDeadline } from '@notifications/core/snooze';
import type { ChannelNotificationSettingsState } from '@notifications/primitives/create-channel-notification-settings';
import { openSectionConflict } from '@notifications/SectionConflictDialog';
import { openSectionSnooze } from '@notifications/SnoozeNotificationsDialog';
import type { Owner } from 'solid-js';
import type { ChannelSectionKey } from '../../../types';

export type SectionNotificationMenus = {
  mute: NotificationMuteMenuProps;
  settings: NotificationSettingsMenuProps;
};

/**
 * A Chat section's own Mute and Notification Settings, stored on the section
 * so they also cover channels added to it later. "All channels" has neither.
 * A change its channels with their own settings wouldn't follow first asks
 * whether to override them.
 */
export function sectionNotificationMenus(
  settings: ChannelNotificationSettingsState,
  options?: {
    /**
     * An owner that outlives the sheet these menus open from, for their
     * dialogs; desktop menus unmount on close and pass none.
     */
    dialogOwner?: Owner | null;
    /**
     * Close the phone sheet before a dialog opens: a touch dialog over the
     * still-open sheet loses its first tap.
     */
    closeSheet?: () => void;
  }
) {
  const dialogOptions = { owner: options?.dialogOwner };
  const openingDialog = () => options?.closeSheet?.();
  const run = (write: Promise<unknown>) =>
    fireAndForget(write, 'channels-view');

  /** Clear the channel setting that keeps it from following the change. */
  const dropOverride = (channelId: string, change: SectionChange) =>
    change.kind === 'mute'
      ? settings.setOverridesSectionMute(channelId, false)
      : settings.followSectionSettings(channelId);

  const changeSection = (
    section: NotificationSectionKey,
    name: string,
    change: SectionChange,
    write: () => Promise<unknown>
  ) => {
    const conflicts = settings.sectionConflicts(section, change);
    if (conflicts.length === 0) {
      run(write());
      return;
    }
    openingDialog();
    openSectionConflict(
      {
        sectionName: name,
        change: change.kind,
        channels: conflicts.map((id) => ({
          id,
          name:
            settings.conflictChannelName(id) ||
            t('channelSections.unnamedChannel'),
        })),
        onConfirm: (overrideIds) =>
          run(
            Promise.all([
              write(),
              ...overrideIds.map((id) => dropOverride(id, change)),
            ])
          ),
      },
      dialogOptions
    );
  };

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
        onMute: (muted) => {
          const write = () =>
            settings.setSectionMute(section, {
              state: muted ? 'muted' : 'unmuted',
            });
          // Unmuting can't leave a channel behind: its own mute still wins.
          if (muted) changeSection(section, name, { kind: 'mute' }, write);
          else run(write());
        },
        onSnooze: (until) => {
          const snooze = (deadline: string) => () =>
            settings.setSectionMute(section, {
              state: 'snoozed',
              until: deadline,
            });
          if (until) {
            changeSection(
              section,
              name,
              { kind: 'mute' },
              snooze(until.toISOString())
            );
            return;
          }
          openingDialog();
          openSectionSnooze((deadline) => {
            if (settings.sectionConflicts(section, { kind: 'mute' }).length) {
              changeSection(section, name, { kind: 'mute' }, snooze(deadline));
              return Promise.resolve(true);
            }
            return snooze(deadline)();
          }, dialogOptions);
        },
      },
      settings: {
        preset: view.preset,
        enabled: view.enabled,
        targetName: name,
        disabled: settings.pending(),
        onPreset: (preset) =>
          changeSection(
            section,
            name,
            { kind: 'kinds', kinds: new Set(PRESET_KINDS[preset]) },
            () => settings.setSectionPreset(section, preset)
          ),
        onSetKinds: (kinds) =>
          changeSection(section, name, { kind: 'kinds', kinds }, () =>
            settings.setSectionKinds(section, kinds)
          ),
        // The phone page saves once on leaving, so the check runs once.
        saveCustomOnLeave: true,
      },
    };
  };
}
