import { Show } from 'solid-js';
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
}) {
  const choice = () => choices.find((option) => option.id === props.sharing);
  return (
    <SettingsSection
      title="Team sharing"
      description="What teammates can see in Macro. Sharing in Google Calendar or Outlook stays the same."
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
  );
}
