import { createUniqueId, Show } from 'solid-js';
import { useDateTimeRange } from './date-time-range-context';
import { TimeInput } from './time-input';
import { splitLocalDateTime, withLocalTime } from './time-options';

/** The start's clock time, omitted for an all-day range. */
export function StartTime(props: { class?: string }) {
  const range = useDateTimeRange();
  const fieldId = createUniqueId();
  return (
    <Show when={!range.allDay}>
      <TimeInput
        id={`range-start-time-${fieldId}`}
        label={`${range.subject} start time`}
        value={splitLocalDateTime(range.start).time}
        timeFormat={range.timeFormat}
        onChange={(option) =>
          range.onStartChange(withLocalTime(range.start, option.value))
        }
        disabled={range.startDisabled}
        invalid={range.invalid}
        describedBy={range.describedBy}
        class={props.class}
      />
    </Show>
  );
}
