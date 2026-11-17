import { createUniqueId, Show } from 'solid-js';
import { useDateTimeRange } from './date-time-range-context';
import { createEndTimeField } from './primitives/create-end-time-field';
import { TimeInput } from './time-input';

/** The end's clock time, with durations and midnight rollover from the start. */
export function EndTime(props: { class?: string; splitMeridiem?: boolean }) {
  const range = useDateTimeRange();
  const fieldId = createUniqueId();
  const field = createEndTimeField(range);
  return (
    <Show when={!range.allDay}>
      <TimeInput
        id={`range-end-time-${fieldId}`}
        label={`${range.subject} end time`}
        value={field.value()}
        timeFormat={range.timeFormat}
        options={field.options()}
        selectedId={field.selectedId()}
        onChange={field.onChange}
        disabled={range.endDisabled}
        invalid={range.invalid}
        describedBy={range.describedBy}
        class={props.class}
        splitMeridiem={props.splitMeridiem}
      />
    </Show>
  );
}
