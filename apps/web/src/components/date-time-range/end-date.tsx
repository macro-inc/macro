import { DateField } from './date-field';
import { useDateTimeRange } from './date-time-range-context';
import { splitLocalDateTime, withLocalDate } from './time-options';

/** The end's calendar date, including its time when changed in a timed range. */
export function EndDate() {
  const range = useDateTimeRange();
  return (
    <DateField
      subject={range.subject}
      label="End"
      date={splitLocalDateTime(range.end).date}
      onChange={(date) =>
        range.onEndChange(range.allDay ? date : withLocalDate(range.end, date))
      }
      disabled={range.endDisabled}
      invalid={range.invalid}
      describedBy={range.describedBy}
      placement="bottom-end"
    />
  );
}
