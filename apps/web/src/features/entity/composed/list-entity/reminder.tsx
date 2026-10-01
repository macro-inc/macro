import {
  describeReminderSchedule,
  scheduleFromRow,
} from '@app/features/reminders/reminder-schedule';
import { Show } from 'solid-js';
import { ReminderRecurrenceBadge } from '../../components/Badges';
import { ReminderTitle } from '../../extractors/reminder-title';
import type { ReminderEntity } from '../../types/entity';

export function ReminderWideContent(props: { entity: ReminderEntity }) {
  const recurrence = () =>
    props.entity.scheduleType === 'recurring'
      ? describeReminderSchedule(scheduleFromRow(props.entity))
      : undefined;
  return (
    <>
      <ReminderTitle entity={props.entity} showNote />
      <Show when={recurrence()}>
        {(text) => <ReminderRecurrenceBadge recurrence={text()} />}
      </Show>
    </>
  );
}
