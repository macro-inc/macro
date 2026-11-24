import { formatLocale } from '@app/lib/i18n';
import CorvuCalendar from '@corvu/calendar';
import { createSignal, Show } from 'solid-js';
import type { CalendarWeekStart } from '../../../types';
import { WhenMonthGrid } from './WhenMonthGrid';

export interface WhenMonthProps {
  size: 'desktop' | 'phone';
  weekStartsOn?: CalendarWeekStart;
  value: Date;
  end?: Date;
  range?: boolean;
  minimum?: Date;
  disabled?: boolean;
  onChange: (start: Date, end?: Date) => void;
}
export function WhenMonth(props: WhenMonthProps) {
  const [pending, setPending] = createSignal<{
    from: Date | null;
    to: Date | null;
  }>();
  const disabled = (date: Date) =>
    Boolean(props.disabled || (props.minimum && date < props.minimum));
  const shared = {
    required: true,
    fixedWeeks: true,
    get startOfWeek() {
      return props.weekStartsOn ?? 0;
    },
    get initialMonth() {
      return props.value;
    },
    get initialFocusedDay() {
      return props.value;
    },
    disabled,
  };
  return (
    <Show
      when={props.range}
      fallback={
        <CorvuCalendar
          mode="single"
          {...shared}
          value={props.value}
          onValueChange={(date) => {
            if (date) props.onChange(date);
          }}
        >
          <WhenMonthGrid size={props.size} locale={formatLocale()} />
        </CorvuCalendar>
      }
    >
      <CorvuCalendar
        mode="range"
        {...shared}
        value={pending() ?? { from: props.value, to: props.end ?? props.value }}
        onValueChange={(value) => {
          const first = pending()?.from;
          if (first && value.from && value.to && value.from < first) {
            setPending({ from: value.from, to: null });
            return;
          }
          if (value.from && value.to) {
            setPending(undefined);
            props.onChange(value.from, value.to);
          } else setPending(value);
        }}
      >
        <WhenMonthGrid size={props.size} locale={formatLocale()} />
      </CorvuCalendar>
    </Show>
  );
}
