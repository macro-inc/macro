import type { DateTimeRangeProps } from '../date-time-range-context';
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
} from '../time-options';

/** Share end-time choices and rollover between desktop and phone presentation. */
export function createEndTimeField(range: DateTimeRangeProps) {
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
  return { anchor, value, options, selectedId, onChange };
}
