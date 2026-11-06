import { InputGroup } from '@ui';
import { batch, createSignal, createUniqueId } from 'solid-js';
import { parseBookingNotice } from '../core/booking-notice';
import { FieldError } from './fields';

/** A single exact time field accepts whole hours and minutes without a unit menu. */
export function BookingTimeInput(props: {
  label: string;
  value: number;
  disabled: boolean;
  formatValue: (minutes: number) => string;
  inputId?: string;
  error?: string;
  errorId?: string;
  onChange: (value: number) => void;
}) {
  const [editing, setEditing] = createSignal<string>();
  const hintId = createUniqueId();
  const generatedErrorId = createUniqueId();
  const errorId = () => props.errorId ?? generatedErrorId;
  const text = () => editing() ?? props.formatValue(props.value);
  const changeText = (text: string) => {
    if (props.disabled) return;
    const value = parseBookingNotice(text);
    batch(() => {
      setEditing(text);
      // Keep parsed values in the draft so owner validation blocks invalid ranges.
      if (value !== undefined && value !== props.value) props.onChange(value);
    });
  };
  return (
    <div class="flex min-w-0 flex-col items-start gap-1.5">
      <InputGroup
        size="lg"
        class="w-auto max-w-full"
        data-number-unit-input
        data-booking-time-input
      >
        <InputGroup.Input
          id={props.inputId}
          type="text"
          required
          disabled={props.disabled}
          aria-label={`${props.label} exact value`}
          aria-invalid={props.error ? true : undefined}
          aria-describedby={[hintId, props.error ? errorId() : undefined]
            .filter(Boolean)
            .join(' ')}
          value={text()}
          class="flex-none px-3 text-base sm:text-sm"
          style={{
            width: `calc(${Math.min(18, Math.max(5, text().length))}ch + 1.5rem)`,
          }}
          onInput={(event) => changeText(event.currentTarget.value)}
          onFocus={(event) => setEditing(event.currentTarget.value)}
          onBlur={() => setEditing(undefined)}
        />
      </InputGroup>
      <span id={hintId} class="sr-only">
        Enter whole hours and minutes, for example 1 hour 30 mins. Numbers
        without units mean minutes.
      </span>
      <FieldError id={errorId()} message={props.error} />
    </div>
  );
}
