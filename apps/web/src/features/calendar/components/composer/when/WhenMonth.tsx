import { formatLocale } from '@app/lib/i18n';
import CorvuCalendar from '@corvu/calendar';
import { createSignal, Show } from 'solid-js';
import { WhenMonthGrid } from './WhenMonthGrid';

export interface WhenMonthProps {
  size: 'desktop' | 'phone';
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
  return (
    <Show
      when={props.range}
      fallback={
        <CorvuCalendar
          mode="single"
          required
          fixedWeeks
          startOfWeek={1}
          value={props.value}
          initialMonth={props.value}
          initialFocusedDay={props.value}
          disabled={disabled}
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
        required
        fixedWeeks
        startOfWeek={1}
        initialMonth={props.value}
        initialFocusedDay={props.value}
        disabled={disabled}
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
