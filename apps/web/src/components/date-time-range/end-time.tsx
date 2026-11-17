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
  const parts = () => splitLocalDateTime(range.end);

  /** The start the end's times count from, while the end is within a day of it. */
  const endAnchor = () => {
    if (range.allDay || !range.start) return undefined;
    return withinEndTimeWindow(range.start, range.end)
      ? range.start
      : undefined;
  };
  const endOptions = () => {
    const start = endAnchor();
    return start
      ? endTimeOptions(splitLocalDateTime(start).time, range.timeFormat)
      : dayTimeOptions(range.timeFormat);
  };
  const endSelectedId = () => {
    const start = endAnchor();
    return selectedTimeOptionId(
      parts().time,
      start ? dayOffsetBetween(start, range.end) : 0
    );
  };
  const changeEndTime = (option: TimeOption) => {
    const start = endAnchor();
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
        value={parts().time}
        timeFormat={range.timeFormat}
        options={endOptions()}
        selectedId={endSelectedId()}
        onChange={changeEndTime}
        disabled={range.endDisabled}
        invalid={range.invalid}
        describedBy={range.describedBy}
        class={props.class}
      />
    </Show>
  );
}
