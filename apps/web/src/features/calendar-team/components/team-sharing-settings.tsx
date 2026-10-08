import { ToggleSwitch } from '@ui';
import { For, Show } from 'solid-js';
import {
  ChoiceRow,
  SettingsCard,
  SettingsRow,
  SettingsSection,
} from '../../settings/primitives';
import type { CalendarSharing } from '../core/model';

const choices: {
  value: CalendarSharing;
  title: string;
  description: string;
}[] = [
  {
    value: 'busy_only',
    title: 'Busy blocks',
    description:
      'Share time blocks from all synced calendars without event details. Calendars you follow are distinguished from your own availability. This is the default.',
  },
  {
    value: 'all',
    title: 'Event details',
    description:
      'Share details from every calendar synced to Macro, including subscribed or delegated calendars, birthdays and holidays. Calendars unchecked in Google Calendar are included if synced. Private and confidential events share only busy blocks when they block time. This does not change Google Calendar permissions.',
  },
  {
    value: 'none',
    title: 'Nothing',
    description:
      'Hide your calendar and availability from teammates in Macro, including team out of office.',
  },
];

export interface AvailabilityCalendarDisplay {
  calendarId: string;
  name: string;
  contributesToAvailability: boolean;
  isPrimary: boolean;
}

export function TeamSharingSettings(props: {
  hasTeam: boolean;
  teamLoading: boolean;
  sharing: CalendarSharing | undefined;
  saving: boolean;
  error: boolean;
  onChange: (sharing: CalendarSharing) => void;
  onRetry: () => void;
  calendars: AvailabilityCalendarDisplay[];
  calendarsLoading: boolean;
  calendarsError: boolean;
  calendarSaving: boolean;
  onCalendarChange: (
    calendarId: string,
    contributesToAvailability: boolean
  ) => void;
}) {
  return (
    <>
      <SettingsSection
        title="Team sharing"
        description="Choose what teammates can read in Macro. Hiding a calendar in your Macro view does not change sharing. Sharing does not invite them to events or give them Google Calendar access."
      >
        <SettingsCard>
          <Show
            when={props.hasTeam}
            fallback={
              <SettingsRow
                label={
                  props.teamLoading
                    ? 'Loading your team…'
                    : props.error
                      ? 'Team sharing unavailable'
                      : 'Join a team to share your calendar'
                }
              >
                <Show when={props.error}>
                  <button
                    type="button"
                    class="text-xs underline"
                    onClick={props.onRetry}
                  >
                    Retry
                  </button>
                </Show>
              </SettingsRow>
            }
          >
            <div class="flex flex-col gap-2 px-6 py-4">
              <For each={choices}>
                {(choice) => (
                  <ChoiceRow
                    name="calendar-team-sharing"
                    value={choice.value}
                    title={choice.title}
                    description={choice.description}
                    checked={props.sharing === choice.value}
                    disabled={props.sharing === undefined || props.saving}
                    onChange={() => props.onChange(choice.value)}
                  />
                )}
              </For>
              <Show when={props.error}>
                <p role="status" class="text-xs text-failure">
                  Could not load your sharing setting.{' '}
                  <button
                    type="button"
                    class="underline"
                    onClick={props.onRetry}
                  >
                    Retry
                  </button>
                </p>
              </Show>
            </div>
          </Show>
        </SettingsCard>
      </SettingsSection>
      <Show when={props.hasTeam}>
        <SettingsSection
          title="Calendars that count as busy"
          description="By default, your primary calendars and meetings you attend count toward your availability. Following someone else's calendar does not make their meetings block your time. Choose any additional calendars that represent your schedule."
        >
          <SettingsCard>
            <Show when={props.calendarsLoading}>
              <SettingsRow label="Loading calendars…" />
            </Show>
            <Show when={props.calendarsError}>
              <SettingsRow label="Could not load availability calendars" />
            </Show>
            <For each={props.calendars}>
              {(calendar) => (
                <SettingsRow
                  label={calendar.name}
                  description={
                    calendar.isPrimary ? 'Primary calendar' : undefined
                  }
                >
                  <ToggleSwitch
                    checked={calendar.contributesToAvailability}
                    disabled={props.calendarSaving}
                    onChange={(included) =>
                      props.onCalendarChange(calendar.calendarId, included)
                    }
                    label={`Count ${calendar.name} toward my availability`}
                    labelClass="sr-only"
                  />
                </SettingsRow>
              )}
            </For>
          </SettingsCard>
        </SettingsSection>
      </Show>
    </>
  );
}
