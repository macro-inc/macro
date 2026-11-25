import { DateField } from './date-field';
import { useDateTimeRange } from './date-time-range-context';
import { splitLocalDateTime, withLocalDate } from './time-options';

/** The start's calendar date, including its time when changed in a timed range. */
export function StartDate() {
  const range = useDateTimeRange();
  return (
    <DateField
      id={range.id}
      subject={range.subject}
      label="Start"
      date={splitLocalDateTime(range.start).date}
      onChange={(date) =>
        range.onStartChange(
          range.allDay ? date : withLocalDate(range.start, date)
        )
      }
      disabled={range.startDisabled}
      invalid={range.invalid}
      describedBy={range.describedBy}
      placement="bottom-start"
    />
  );
}
