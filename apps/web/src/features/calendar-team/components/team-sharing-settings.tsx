import { Show } from 'solid-js';
import { SourceControls } from '../../calendar/components/SourceControls';
import type { CalendarSource } from '../../calendar/types';
import { SettingsSelect } from '../../settings/components/settings-select';
import {
  SettingsCard,
  SettingsRow,
  SettingsSection,
} from '../../settings/primitives';
import type { CalendarSharing } from '../core/model';

const choices: {
  id: CalendarSharing;
  name: string;
  description: string;
}[] = [
  {
    id: 'busy_only',
    name: 'Busy blocks',
    description: 'Teammates see when you are busy, not what.',
  },
  {
    id: 'all',
    name: 'Event details',
    description: 'Teammates see your events. Private events stay busy blocks.',
  },
  {
    id: 'none',
    name: 'Nothing',
    description: 'Teammates cannot see your calendar or availability.',
  },
];

export function TeamSharingSettings(props: {
  hasTeam: boolean;
  teamLoading: boolean;
  sharing: CalendarSharing | undefined;
  error: boolean;
  onChange: (sharing: CalendarSharing) => void;
  onRetry: () => void;
  calendars: CalendarSource[];
  calendarsLoading: boolean;
  calendarsError: boolean;
  isCounted: (calendarId: string) => boolean;
  onCountedChange: (calendarIds: string[], counted: boolean) => void;
}) {
  const choice = () => choices.find((option) => option.id === props.sharing);
  return (
    <>
      <SettingsSection
        title="Team sharing"
        description="What teammates can see in Macro. Google Calendar permissions stay the same."
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
            <SettingsRow
              label="Share with teammates"
              description={
                props.error
                  ? 'Could not load your sharing setting.'
                  : choice()?.description
              }
              stackOnNarrow
            >
              <Show
                when={!props.error}
                fallback={
                  <button
                    type="button"
                    class="text-xs underline"
                    onClick={props.onRetry}
                  >
                    Retry
                  </button>
                }
              >
                <SettingsSelect
                  label="Share with teammates"
                  class="w-44 min-w-0"
                  options={choices}
                  value={props.sharing}
                  placeholder="Loading…"
                  disabled={props.sharing === undefined}
                  onChange={(id) => {
                    const next = choices.find((option) => option.id === id);
                    if (next) props.onChange(next.id);
                  }}
                />
              </Show>
            </SettingsRow>
          </Show>
        </SettingsCard>
      </SettingsSection>
      <Show when={props.hasTeam}>
        <SettingsSection
          title="Calendars that count as busy"
          description="Checked calendars block your time when teammates or agents check your availability."
        >
          <Show when={props.calendarsLoading}>
            <p role="status" class="text-sm text-ink-muted">
              Loading calendars…
            </p>
          </Show>
          <Show when={props.calendarsError}>
            <p role="status" class="text-sm text-ink-muted">
              Could not load your calendars.{' '}
              <button type="button" class="underline" onClick={props.onRetry}>
                Retry
              </button>
            </p>
          </Show>
          <div class="-mx-2">
            <SourceControls
              sources={props.calendars}
              isVisible={props.isCounted}
              onVisibilityChange={(calendarId, counted) =>
                props.onCountedChange([calendarId], counted)
              }
              onGroupVisibilityChange={props.onCountedChange}
            />
          </div>
        </SettingsSection>
      </Show>
    </>
  );
}
