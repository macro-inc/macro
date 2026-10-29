import { useLocale } from '@kobalte/core/i18n';
import { cn, Slider, Tooltip } from '@ui';
import { createSignal, createUniqueId, For, type JSX, Show } from 'solid-js';
import {
  type BookingValueUnit,
  describeBookingValue,
} from '../core/booking-units';
import { BookingFieldInfo } from './booking-field-info';
import { FieldError } from './fields';
import { createSliderPointerIntent } from './slider-pointer-intent';

/** Slider gestures edit common values; the adjacent input retains every supported exact value. */
export function BookingValueSlider(props: {
  label: string;
  description?: string;
  value: number;
  min: number;
  max: number;
  sliderMax?: number;
  sliderStep?: number;
  unit: string;
  units?: readonly BookingValueUnit[];
  minLabel?: string;
  maxLabel?: string;
  zeroLabel?: string;
  marks?: readonly { value: number; label?: string }[];
  disabled: boolean;
  rowClass?: string;
  error?: string;
  onChange: (value: number) => void;
  children: (errorId: string) => JSX.Element;
}) {
  const errorId = createUniqueId();
  const [hovered, setHovered] = createSignal(false);
  const [focused, setFocused] = createSignal(false);
  const [dragging, setDragging] = createSignal(false);
  const [fine, setFine] = createSignal(false);
  const pointerIntent = createSliderPointerIntent();
  const movePointer = (event: PointerEvent) => {
    pointerIntent.move(event);
    setFine(event.ctrlKey);
  };
  const startDrag = (event: PointerEvent) => {
    setFine(event.ctrlKey);
    setDragging(true);
  };
  const finishDrag = () => {
    pointerIntent.end();
    setDragging(false);
    setFine(false);
  };
  const { direction } = useLocale();
  let keyboardGesture = false;
  const max = () => props.sliderMax ?? props.max;
  const bounded = () =>
    Math.min(
      max(),
      Math.max(
        props.min,
        Number.isFinite(props.value) ? props.value : props.min
      )
    );
  const units = () =>
    props.units ?? [
      { id: props.unit, label: props.unit, short: props.unit, factor: 1 },
    ];
  const describe = (value: number) => describeBookingValue(value, units());
  const overflow = () => props.value > max();
  const maxLabel = () =>
    props.maxLabel ?? `${describe(max())}${max() < props.max ? '+' : ''}`;
  const valueLabel = () => {
    if (overflow()) return `${describe(max())}+`;
    if (props.value === 0 && props.minLabel) return props.minLabel;
    if (
      props.unit === 'min' &&
      props.value >= 60 &&
      units().some((unit) => unit.factor === 60)
    ) {
      const hours = Math.floor(props.value / 60);
      const minutes = props.value % 60;
      return `${hours} ${hours === 1 ? 'hour' : 'hours'}${minutes ? ` ${minutes} ${minutes === 1 ? 'min' : 'mins'}` : ''}`;
    }
    return describe(props.value);
  };
  const sliderMinimum = () =>
    Math.floor(props.min / (props.sliderStep ?? 1)) * (props.sliderStep ?? 1);
  const update = (value: number) => {
    const next = Math.min(max(), Math.max(props.min, Math.round(value)));
    if (!props.disabled && (next !== props.value || props.error))
      props.onChange(next);
  };
  const keyboard = (event: KeyboardEvent) => {
    if (props.disabled) return;
    const increment = event.ctrlKey ? 1 : (props.sliderStep ?? 1);
    const horizontal = direction() === 'rtl' ? -1 : 1;
    const tick = (sign: number) =>
      sign > 0
        ? (Math.floor(bounded() / increment) + 1) * increment
        : (Math.ceil(bounded() / increment) - 1) * increment;
    const values: Record<string, number> = {
      ArrowLeft: tick(-horizontal),
      ArrowRight: tick(horizontal),
      ArrowDown: tick(-1),
      ArrowUp: tick(1),
      PageDown: bounded() - increment * 10,
      PageUp: bounded() + increment * 10,
      Home: props.min,
      End: max(),
    };
    if (values[event.key] === undefined) return;
    event.preventDefault();
    keyboardGesture = true;
    queueMicrotask(() => {
      keyboardGesture = false;
    });
    update(values[event.key]);
  };
  const position = (value: number) =>
    ((value - sliderMinimum()) / (max() - sliderMinimum())) * 100;
  const tooltipVisible = () =>
    !props.disabled && (hovered() || focused() || dragging());
  return (
    <Slider
      value={[bounded()]}
      minValue={sliderMinimum()}
      maxValue={max()}
      step={fine() ? 1 : (props.sliderStep ?? 1)}
      disabled={props.disabled}
      validationState={props.error ? 'invalid' : 'valid'}
      getValueLabel={() =>
        overflow()
          ? `${valueLabel()}, exact value ${describe(props.value)}`
          : valueLabel()
      }
      class="gap-2"
      onPointerMove={movePointer}
      onPointerUp={finishDrag}
      onPointerCancel={finishDrag}
      onLostPointerCapture={finishDrag}
      onChange={(values) => {
        if (!keyboardGesture && !pointerIntent.ignoresChange())
          update(values[0]);
      }}
    >
      <div class="flex items-center gap-1" data-booking-slider-label>
        <Slider.Label class="text-sm font-normal text-ink-muted">
          {props.label}
        </Slider.Label>
        <Show when={props.description}>
          {(description) => (
            <BookingFieldInfo label={props.label} description={description()} />
          )}
        </Show>
      </div>
      <div
        class={cn('flex min-w-0 items-center gap-4', props.rowClass)}
        data-booking-slider-row
      >
        <div class="min-w-0 flex-1">
          <div
            class="flex justify-between gap-2 text-[11px] text-ink-muted"
            aria-hidden="true"
            data-booking-slider-scale
          >
            <span>{props.minLabel ?? describe(props.min)}</span>
            <span>{maxLabel()}</span>
          </div>
          <Slider.Track
            class="my-2"
            onPointerEnter={() => setHovered(true)}
            onPointerLeave={() => setHovered(false)}
            onPointerDown={startDrag}
            onPointerMove={movePointer}
            onPointerUp={finishDrag}
            onPointerCancel={finishDrag}
            onLostPointerCapture={finishDrag}
          >
            <Slider.Fill />
            <Show when={props.marks}>
              <div
                class="pointer-events-none absolute inset-0"
                aria-hidden="true"
                data-booking-slider-marks
              >
                <For each={props.marks}>
                  {(mark) => (
                    <span
                      class="absolute top-1/2 size-1 rounded-full -translate-x-1/2 -translate-y-1/2 bg-ink-muted/70 rtl:translate-x-1/2"
                      style={{
                        'inset-inline-start': `${position(mark.value)}%`,
                      }}
                    />
                  )}
                </For>
              </div>
            </Show>
            <Slider.Thumb
              aria-valuemin={props.min}
              aria-valuemax={max()}
              aria-valuenow={bounded()}
              aria-valuetext={
                overflow()
                  ? `${valueLabel()}, exact value ${describe(props.value)}`
                  : valueLabel()
              }
              aria-invalid={props.error ? true : undefined}
              aria-disabled={props.disabled ? true : undefined}
              aria-describedby={props.error ? errorId : undefined}
              onPointerDown={(event) => {
                pointerIntent.thumbDown(event);
                startDrag(event);
              }}
              onPointerMove={movePointer}
              onPointerUp={finishDrag}
              onPointerCancel={finishDrag}
              onLostPointerCapture={finishDrag}
              onKeyDown={keyboard}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              class="border-2 border-ink bg-ink"
            >
              <Tooltip
                label={valueLabel()}
                open={tooltipVisible()}
                disabled={props.disabled}
                as="span"
                class="absolute inset-0"
                placement="bottom"
              >
                <span aria-hidden="true" class="block size-full" />
              </Tooltip>
            </Slider.Thumb>
          </Slider.Track>
          <Show when={props.marks}>
            <div
              class="relative h-4 text-[10px] text-ink-muted"
              aria-hidden="true"
              data-booking-slider-mark-labels
            >
              <For each={props.marks}>
                {(mark) => (
                  <span
                    class="absolute -translate-x-1/2 rtl:translate-x-1/2"
                    style={{ 'inset-inline-start': `${position(mark.value)}%` }}
                  >
                    <span>{mark.label}</span>
                  </span>
                )}
              </For>
            </div>
          </Show>
          <FieldError id={errorId} message={props.error} />
        </div>
        <div class="min-w-0 shrink-0">{props.children(errorId)}</div>
      </div>
    </Slider>
  );
}
