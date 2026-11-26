import { createContext, type JSX, useContext } from 'solid-js';
import type { ClockDisplayFormat } from './clock-format';

export interface DateTimeRangeProps {
  /** What the range belongs to, named in the fields' labels: `event`, a column's name. */
  subject: string;
  /** The start field's id, for a label to name or a caller to focus. */
  id?: string;
  /** `YYYY-MM-DD` when all day, else local `YYYY-MM-DDTHH:mm`; empty when unset. */
  start: string;
  end: string;
  allDay: boolean;
  /** Calendar strings use compact markers; native hour12 booleans keep locale labels. */
  timeFormat?: ClockDisplayFormat;
  onStartChange: (value: string) => void;
  onEndChange: (value: string) => void;
  startDisabled?: boolean;
  endDisabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
}

const DateTimeRangeContext = createContext<DateTimeRangeProps>();

export function useDateTimeRange() {
  const range = useContext(DateTimeRangeContext);
  if (!range)
    throw new Error('DateTimeRange parts must be rendered inside Root');
  return range;
}

export function Root(props: DateTimeRangeProps & { children: JSX.Element }) {
  return (
    <DateTimeRangeContext.Provider value={props}>
      {props.children}
    </DateTimeRangeContext.Provider>
  );
}
