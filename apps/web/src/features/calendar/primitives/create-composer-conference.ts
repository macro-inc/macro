import { t } from '@app/lib/i18n';
import type { CalendarCapabilities } from '@service-calendar/generated/schemas/calendarCapabilities';
import { type Accessor, createMemo } from 'solid-js';
import type { EventEditorConferenceChoice } from '../components/composer/event-form-model';

interface ConferenceChoice {
  value: EventEditorConferenceChoice;
  label: string;
}
const MACRO: ConferenceChoice = { value: 'macro', label: 'Macro call' };
const MEET: ConferenceChoice = { value: 'google_meet', label: 'Google Meet' };
const TEAMS: ConferenceChoice = {
  value: 'microsoft_teams',
  label: 'Microsoft Teams',
};
const EXISTING: ConferenceChoice = {
  value: 'existing',
  get label() {
    return t('calendar.currentConferencing');
  },
};
const NONE: ConferenceChoice = {
  value: 'none',
  get label() {
    return t('calendar.noMeetingLink');
  },
};

export function createComposerConference(options: {
  provider: Accessor<CalendarCapabilities['conferenceProvider'] | undefined>;
  value: Accessor<EventEditorConferenceChoice>;
  canKeepExisting: Accessor<boolean>;
  disabled: Accessor<boolean>;
  onChange: (value: EventEditorConferenceChoice) => void;
}) {
  const provider = createMemo(options.provider);
  const keepExisting = createMemo(options.canKeepExisting);
  const choices = createMemo(() => {
    const choices: ConferenceChoice[] = [];
    choices.push(MACRO);
    const currentProvider = provider();
    if (currentProvider === 'microsoft_teams') choices.push(TEAMS);
    else if (currentProvider !== null && currentProvider !== 'other')
      choices.push(MEET);
    if (keepExisting()) choices.push(EXISTING);
    choices.push(NONE);
    return choices;
  });
  return {
    choices,
    selected: () =>
      choices().find((choice) => choice.value === options.value()) ??
      choices()[0],
    choose: (value: string) => {
      if (options.disabled()) return;
      const choice = choices().find((choice) => choice.value === value);
      if (choice) options.onChange(choice.value);
    },
  };
}
