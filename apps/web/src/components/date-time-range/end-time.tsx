import { createUniqueId, Show } from 'solid-js';
import { useDateTimeRange } from './date-time-range-context';
import { TimeInput } from './time-input';
import {
  dayOffsetBetween,
  dayTimeOptions,
  endTimeOptions,
  endValueFor,
  selectedTimeOptionId,
  splitLocalDateTime,
  type TimeOption,
  withinEndTimeWindow,
  withLocalTime,
} from './time-options';

/** The end's clock time, with durations and midnight rollover from the start. */
export function EndTime(props: { class?: string }) {
  const range = useDateTimeRange();
  const fieldId = createUniqueId();
  const anchor = () => {
    if (range.allDay || !range.start) return undefined;
    return withinEndTimeWindow(range.start, range.end)
      ? range.start
      : undefined;
  };
  const value = () => splitLocalDateTime(range.end).time;
  const options = () => {
    const start = anchor();
    return start
      ? endTimeOptions(splitLocalDateTime(start).time, range.timeFormat)
      : dayTimeOptions(range.timeFormat);
  };
  const selectedId = () => {
    const start = anchor();
    return selectedTimeOptionId(
      value(),
      start ? dayOffsetBetween(start, range.end) : 0
    );
  };
  const onChange = (option: TimeOption) => {
    const start = anchor();
    range.onEndChange(
      start
        ? endValueFor(start, option)
        : withLocalTime(range.end, option.value)
    );
  };
  return (
    <Show when={!range.allDay}>
      <TimeInput
        id={`range-end-time-${fieldId}`}
        label={`${range.subject} end time`}
        value={value()}
        timeFormat={range.timeFormat}
        options={options()}
        selectedId={selectedId()}
        onChange={onChange}
        disabled={range.endDisabled}
        invalid={range.invalid}
        describedBy={range.describedBy}
        class={props.class}
      />
    </Show>
  );
}
