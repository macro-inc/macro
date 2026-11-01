import { createTimeOptions } from '@core/util/dateSearch/timeOptions';
import { type ComponentProps, createSignal } from 'solid-js';
import { EmailReminderForm } from '../components/email-reminder-form';
import type { EmailReminderCondition } from '../core/email-reminder';
import {
  REMINDER_DEFAULT_TIME,
  reminderQuickPresets,
} from '../reminder-schedule';

type Props = Omit<
  ComponentProps<typeof EmailReminderForm>,
  'query' | 'onQueryChange' | 'condition' | 'onConditionChange' | 'times'
> & {
  initialCondition?: EmailReminderCondition;
};

export function EmailReminderMenu(props: Props) {
  const [query, setQuery] = createSignal('');
  const [condition, setCondition] = createSignal<EmailReminderCondition>();
  const times = createTimeOptions({
    query,
    defaultTime: REMINDER_DEFAULT_TIME,
    presets: reminderQuickPresets,
  });
  return (
    <EmailReminderForm
      {...props}
      query={query()}
      onQueryChange={setQuery}
      condition={condition() ?? props.initialCondition ?? 'if_no_reply'}
      onConditionChange={setCondition}
      times={times()}
    />
  );
}
