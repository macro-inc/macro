import { Show } from 'solid-js';
import { CustomRecurrenceContext } from '../../../context/custom-recurrence-context';
import {
  type CustomRecurrenceInput,
  createCustomRecurrence,
} from '../../../primitives/create-custom-recurrence';
import { RecurrenceEnds } from './RecurrenceEnds';
import { RecurrenceFrequency } from './RecurrenceFrequency';
import { RecurrenceWeekdays } from './RecurrenceWeekdays';

export function CustomRecurrence(props: CustomRecurrenceInput) {
  const model = createCustomRecurrence(props);
  return (
    <CustomRecurrenceContext.Provider value={model}>
      <div class="flex flex-col gap-3 rounded-xl bg-control p-3">
        <p class="text-sm text-ink">{model.description()}</p>
        <RecurrenceFrequency />
        <Show when={props.value.frequency === 'WEEKLY'}>
          <RecurrenceWeekdays />
        </Show>
        <RecurrenceEnds />
      </div>
    </CustomRecurrenceContext.Provider>
  );
}
