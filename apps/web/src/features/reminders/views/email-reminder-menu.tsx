import { type ComponentProps, createSignal } from 'solid-js';
import { EmailReminderForm } from '../components/email-reminder-form';
import type { EmailReminderCondition } from '../core/email-reminder';
import { createReminderTimeOptions } from '../primitives/create-reminder-time-options';

type Props = Omit<
  ComponentProps<typeof EmailReminderForm>,
  'query' | 'onQueryChange' | 'condition' | 'onConditionChange' | 'times'
> & {
  initialCondition?: EmailReminderCondition;
};

export function EmailReminderMenu(props: Props) {
  const [query, setQuery] = createSignal('');
  const [condition, setCondition] = createSignal(
    props.initialCondition ?? 'if_no_reply'
  );
  const times = createReminderTimeOptions(query);
  return (
    <EmailReminderForm
      {...props}
      query={query()}
      onQueryChange={setQuery}
      condition={condition()}
      onConditionChange={setCondition}
      times={times()}
    />
  );
}
