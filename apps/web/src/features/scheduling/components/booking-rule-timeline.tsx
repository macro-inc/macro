import { useLocale } from '@kobalte/core/i18n';
import { Slider } from '@ui';
import { createUniqueId, For, Show } from 'solid-js';
import {
  bookingTimelinePosition,
  bookingTimelineValue,
} from '../core/booking-rule-timeline';
import { describeBookingValue, MINUTE_UNITS } from '../core/booking-units';

/** A scaled track edits one field only; its labelled landmarks expose the scale. */
export function BookingRuleTimeline(props: {
  label: string;
  value: number;
  landmarks: readonly number[];
  marks: readonly string[];
  disabled: boolean;
  reverse?: boolean;
  days?: boolean;
  error?: string;
  showMarks?: boolean;
  onChange: (value: number) => void;
}) {
  const descriptionId = createUniqueId();
  const { direction } = useLocale();
  const increasingRight = () => (direction() === 'ltr') !== !!props.reverse;
  let keyboardGesture = false;
  const boundedValue = () =>
    Math.min(
      props.landmarks.at(-1)!,
      Math.max(
        props.landmarks[0],
        Number.isFinite(props.value) ? props.value : props.landmarks[0]
      )
    );
  const describe = () => {
    if (!Number.isFinite(props.value)) return 'Set value';
    if (props.days)
      return `${props.value} ${props.value === 1 ? 'day' : 'days'}`;
    if (!Number.isInteger(props.value)) return `${props.value} minutes`;
    return describeBookingValue(props.value, MINUTE_UNITS);
  };
  const keyboard = (event: KeyboardEvent) => {
    if (props.disabled) return;
    const min = props.landmarks[0];
    const max = props.landmarks.at(-1)!;
    const value = boundedValue();
    const increment = event.shiftKey ? (props.days ? 7 : 15) : 1;
    const horizontal = increasingRight() ? 1 : -1;
    const values: Record<string, number> = {
      ArrowLeft: value - increment * horizontal,
      ArrowRight: value + increment * horizontal,
      ArrowDown: value - increment,
      ArrowUp: value + increment,
      PageDown: value - (props.days ? 7 : 60),
      PageUp: value + (props.days ? 7 : 60),
      Home: min,
      End: max,
    };
    const next = values[event.key];
    if (next === undefined) return;
    event.preventDefault();
    // Kobalte also handles the key after this callback. Ignore its scaled update.
    keyboardGesture = true;
    queueMicrotask(() => {
      keyboardGesture = false;
    });
    props.onChange(Math.min(max, Math.max(min, Math.round(next))));
  };
  return (
    <Slider
      aria-label={props.label}
      value={[bookingTimelinePosition(boundedValue(), props.landmarks)]}
      minValue={0}
      maxValue={100}
      step={0.1}
      inverted={props.reverse}
      disabled={props.disabled}
      validationState={props.error ? 'invalid' : 'valid'}
      getValueLabel={() => describe()}
      class="gap-0"
      onChange={(values) => {
        if (props.disabled || keyboardGesture) return;
        const value = bookingTimelineValue(values[0], props.landmarks);
        if (value !== props.value) props.onChange(value);
      }}
    >
      <Slider.Track
        class="my-2 aria-invalid:ring-2 aria-invalid:ring-failure/30"
        aria-invalid={props.error ? true : undefined}
      >
        <Slider.Fill class="bg-accent/60" />
        <Slider.Thumb
          aria-label={props.label}
          aria-valuemin={props.landmarks[0]}
          aria-valuemax={props.landmarks.at(-1)}
          aria-valuenow={Number.isFinite(props.value) ? props.value : undefined}
          aria-invalid={props.error ? true : undefined}
          aria-valuetext={describe()}
          aria-describedby={descriptionId}
          onKeyDown={keyboard}
          aria-disabled={props.disabled ? true : undefined}
          style={{
            transform: increasingRight()
              ? 'translateX(-50%)'
              : 'translateX(50%)',
          }}
          class="size-4 border-2 border-ink bg-ink"
        />
        {/* The scaled position is internal. Expose only the thumb's actual-value slider. */}
      </Slider.Track>
      <Show when={props.showMarks !== false}>
        <div
          class="relative h-3 text-[10px] leading-3 text-ink-muted"
          aria-hidden="true"
        >
          <For each={props.marks}>
            {(mark, index) => {
              const position = () => (index() / (props.marks.length - 1)) * 100;
              const left = () =>
                increasingRight() ? position() : 100 - position();
              return (
                <span
                  class="absolute whitespace-nowrap"
                  style={{
                    left: `${left()}%`,
                    transform:
                      left() === 0
                        ? undefined
                        : left() === 100
                          ? 'translateX(-100%)'
                          : 'translateX(-50%)',
                  }}
                >
                  {mark}
                </span>
              );
            }}
          </For>
        </div>
      </Show>
      <span id={descriptionId} class="sr-only">
        {props.marks.length > 2 ? 'Scaled time. ' : ''}
        Arrow keys adjust by one {props.days ? 'day' : 'minute'}. The manual
        input below accepts exact values. {props.error}
      </span>
    </Slider>
  );
}
