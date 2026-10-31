import { NextMeetingBadgePill } from '@app/features/meetings/components/next-meeting-badge-pill';
import {
  SettingsCard,
  SettingsRow,
  SettingsSection,
} from '@app/features/settings/primitives';
import CalendarBlankIcon from '@phosphor/calendar-blank.svg';
import { ToggleSwitch } from '@ui';
import { Show } from 'solid-js';
import { useCalendarPreferences } from '../utils/preferences';

/** The sidebar's Calendar button as it will look, pill and all. */
function NextMeetingBadgePreview(props: { shown: boolean }) {
  return (
    <span
      aria-hidden="true"
      data-next-meeting-preview={props.shown ? 'shown' : 'hidden'}
      class="relative flex size-10 shrink-0 items-center justify-center rounded-xl border border-edge-muted bg-page text-ink"
    >
      <CalendarBlankIcon class="size-5" />
      <Show when={props.shown}>
        <NextMeetingBadgePill label="23m" class="ring-page" />
      </Show>
    </span>
  );
}

/** Settings → Calendar switch for the sidebar Calendar button's countdown. */
export function NextMeetingCountdownSetting() {
  const [preferences, setPreferences] = useCalendarPreferences();
  return (
    <SettingsSection title="Sidebar">
      <SettingsCard>
        <SettingsRow
          label="Next meeting countdown"
          description="Count down to your next meeting on the sidebar's Calendar icon, and show Now while one is happening."
        >
          <NextMeetingBadgePreview shown={preferences.showNextMeetingBadge} />
          <ToggleSwitch
            size="md"
            label="Next meeting countdown"
            labelClass="sr-only"
            checked={preferences.showNextMeetingBadge}
            onChange={(checked) =>
              setPreferences('showNextMeetingBadge', checked)
            }
          />
        </SettingsRow>
      </SettingsCard>
    </SettingsSection>
  );
}
