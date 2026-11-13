import { createNaturalTime } from '@core/natural-time/create-natural-time';
import { type ComponentProps, createSignal } from 'solid-js';
import { EmailReminderForm } from '../components/email-reminder-form';
import type { EmailReminderCondition } from '../core/email-reminder';
import { createReminderTimeOptions } from '../primitives/create-reminder-time-options';

type Props = Omit<
  ComponentProps<typeof EmailReminderForm>,
  | 'query'
  | 'onQueryChange'
  | 'condition'
  | 'onConditionChange'
  | 'times'
  | 'reason'
> & {
  initialCondition?: EmailReminderCondition;
};

export function EmailReminderMenu(props: Props) {
  const [query, setQuery] = createSignal('');
  const [condition, setCondition] = createSignal<EmailReminderCondition>();
  const choices = createReminderTimeOptions(query, createNaturalTime());
  return (
    <EmailReminderForm
      {...props}
      query={query()}
      onQueryChange={setQuery}
      condition={condition() ?? props.initialCondition ?? 'if_no_reply'}
      onConditionChange={setCondition}
      times={choices().times}
      reason={choices().reason}
    />
  );
}
