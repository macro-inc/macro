import { useLocale } from '@kobalte/core/i18n';
import { Slider, Tooltip } from '@ui';
import { createSignal, createUniqueId, For } from 'solid-js';
import { formatBookingNotice } from '../core/booking-notice';
import {
  BOOKING_RANGE_TIMELINE,
  bookingNoticeTick,
  bookingTimelinePosition,
  bookingTimelineValue,
  snapBookingNotice,
} from '../core/booking-rule-timeline';
import { DAY_UNITS } from '../core/booking-units';
import type { EventType, EventValidationIssue } from '../core/types';
import { BookingFieldInfo } from './booking-field-info';
import { BookingTimeInput } from './booking-time-input';
import { BookingValueInput } from './booking-value-input';
import { createSliderPointerIntent } from './slider-pointer-intent';

type RangeField = 'noticeMinutes' | 'horizonDays';
const MINUTES_PER_DAY = 1440;
const SLIDER_MAX_DAYS = 30;
const RANGE_MARKS = [
  { value: 60, label: '1 h' },
  { value: 240, label: '4 h' },
  { value: 1440, label: '1 d' },
  { value: 10080, label: '7 d' },
  { value: 20160, label: '14 d' },
] as const;
const RANGE_DAY_UNITS = DAY_UNITS.slice(0, 1);

/** The displayed scale clips outliers, while exact inputs retain the stored range. */
export function BookingRange(props: {
  draft: EventType;
  disabled: boolean;
  issues?: EventValidationIssue[];
  onUpdate: <K extends keyof EventType>(key: K, value: EventType[K]) => void;
}) {
  const headingId = createUniqueId();
  const fromId = createUniqueId();
  const toId = createUniqueId();
  const fromErrorId = createUniqueId();
  const toErrorId = createUniqueId();
  const [hovered, setHovered] = createSignal<RangeField>();
  const [focused, setFocused] = createSignal<RangeField>();
  const [dragging, setDragging] = createSignal<RangeField>();
  const [fine, setFine] = createSignal(false);
  const { direction } = useLocale();
  let keyboardGesture = false;
  const pointerIntent = createSliderPointerIntent();
  const beginPointer = (event: PointerEvent) => setFine(event.ctrlKey);
  const movePointer = (event: PointerEvent) => {
    pointerIntent.move(event);
    setFine(event.ctrlKey);
  };
  const finishDrag = () => {
    pointerIntent.end();
    setDragging(undefined);
    setFine(false);
  };
  const tooltipVisible = (field: RangeField) =>
    !props.disabled &&
    (hovered() === field || focused() === field || dragging() === field);
  const error = (field: RangeField) =>
    props.issues?.find((issue) => issue.field === field)?.message;
  const update = (field: RangeField, value: number) => {
    if (!props.disabled) props.onUpdate(field, value);
  };
  const latest = () =>
    Number.isFinite(props.draft.horizonDays)
      ? Math.min(SLIDER_MAX_DAYS, Math.max(1, props.draft.horizonDays))
      : 1;
  const earliest = () =>
    Number.isFinite(props.draft.noticeMinutes)
      ? Math.min(10080, Math.max(0, props.draft.noticeMinutes))
      : 0;
  const positions = () => {
    const last = bookingTimelinePosition(
      latest() * MINUTES_PER_DAY,
      BOOKING_RANGE_TIMELINE
    );
    return [
      Math.min(
        bookingTimelinePosition(earliest(), BOOKING_RANGE_TIMELINE),
        last
      ),
      last,
    ];
  };
  const changeNotice = (value: number) => {
    const horizon = Number.isFinite(props.draft.horizonDays)
      ? props.draft.horizonDays
      : 365;
    update(
      'noticeMinutes',
      Math.max(
        0,
        Math.min(10080, horizon * MINUTES_PER_DAY - 1, Math.round(value))
      )
    );
  };
  const changeHorizon = (value: number) => {
    const notice = Number.isFinite(props.draft.noticeMinutes)
      ? props.draft.noticeMinutes
      : 0;
    update(
      'horizonDays',
      Math.min(
        SLIDER_MAX_DAYS,
        Math.max(1, Math.floor(notice / MINUTES_PER_DAY) + 1, Math.round(value))
      )
    );
  };
  const describeNotice = () =>
    props.draft.noticeMinutes === 0
      ? 'Immediately'
      : formatBookingNotice(props.draft.noticeMinutes);
  const describeHorizon = () =>
    `${props.draft.horizonDays} ${props.draft.horizonDays === 1 ? 'day' : 'days'}`;
  const horizonLabel = () =>
    props.draft.horizonDays > SLIDER_MAX_DAYS
      ? `30 days+ (exact value ${describeHorizon()})`
      : describeHorizon();
  const keyboard = (field: RangeField, event: KeyboardEvent) => {
    if (props.disabled) return;
    const notice = field === 'noticeMinutes';
    const value = notice ? earliest() : latest();
    const increment = event.ctrlKey
      ? 1
      : event.shiftKey
        ? notice
          ? 60
          : 7
        : 1;
    const tick = (sign: number) =>
      notice && !event.ctrlKey && !event.shiftKey
        ? bookingNoticeTick(value, sign)
        : value + sign * increment;
    const pageStep = (sign: number) =>
      notice
        ? value + (sign < 0 ? -1 : 0) < MINUTES_PER_DAY
          ? 60
          : MINUTES_PER_DAY
        : 7;
    const horizontal = direction() === 'rtl' ? -1 : 1;
    const values: Record<string, number> = {
      ArrowLeft: tick(-horizontal),
      ArrowRight: tick(horizontal),
      ArrowDown: tick(-1),
      ArrowUp: tick(1),
      PageDown: value - pageStep(-1),
      PageUp: value + pageStep(1),
      Home: notice ? 0 : 1,
      End: notice ? 10080 : SLIDER_MAX_DAYS,
    };
    if (values[event.key] === undefined) return;
    event.preventDefault();
    keyboardGesture = true;
    queueMicrotask(() => {
      keyboardGesture = false;
    });
    if (notice) changeNotice(values[event.key]);
    else if (
      props.draft.horizonDays <= SLIDER_MAX_DAYS ||
      values[event.key] < SLIDER_MAX_DAYS
    )
      changeHorizon(values[event.key]);
  };
  return (
    <section
      aria-label="Meeting times guests can choose"
      class="flex min-w-0 flex-col gap-2"
    >
      <div
        role="group"
        aria-label="Booking range"
        class="flex min-w-0 flex-col gap-3"
        data-booking-range
      >
        <div class="flex items-center gap-1.5">
          <h4
            id={headingId}
            class="text-sm font-normal tracking-wide text-ink-muted"
          >
            Booking range
          </h4>
          <BookingFieldInfo
            label="Booking range"
            description="Left: how soon a meeting can start after booking. Right: how many days ahead guests can book."
          />
        </div>
        <Slider
          aria-labelledby={headingId}
          value={positions()}
          minValue={0}
          maxValue={100}
          step={0.1}
          minStepsBetweenThumbs={0}
          disabled={props.disabled}
          validationState={
            error('noticeMinutes') || error('horizonDays') ? 'invalid' : 'valid'
          }
          class="gap-3"
          onPointerMove={movePointer}
          onPointerUp={finishDrag}
          onPointerCancel={finishDrag}
          onLostPointerCapture={finishDrag}
          onChange={(values) => {
            if (
              props.disabled ||
              keyboardGesture ||
              pointerIntent.ignoresChange()
            )
              return;
            const previous = positions();
            if (values[0] !== previous[0]) {
              const minutes = bookingTimelineValue(
                values[0],
                BOOKING_RANGE_TIMELINE
              );
              changeNotice(fine() ? minutes : snapBookingNotice(minutes));
            } else if (values[1] !== previous[1])
              changeHorizon(
                bookingTimelineValue(values[1], BOOKING_RANGE_TIMELINE) /
                  MINUTES_PER_DAY
              );
          }}
        >
          <div class="flex min-w-0 flex-col gap-1.5" data-booking-range-row>
            <div
              class="flex min-w-0 items-start justify-between gap-2"
              data-booking-range-values
            >
              <div class="min-w-0" data-booking-range-earliest>
                <BookingTimeInput
                  label="What's the earliest someone can book?"
                  inputId={fromId}
                  value={props.draft.noticeMinutes}
                  formatValue={formatBookingNotice}
                  disabled={props.disabled}
                  error={error('noticeMinutes')}
                  errorId={fromErrorId}
                  onChange={(value) => update('noticeMinutes', value)}
                />
              </div>
              <div
                class="flex min-w-0 flex-col items-end"
                data-booking-range-latest
              >
                <BookingValueInput
                  label="What's the latest someone can book?"
                  inputId={toId}
                  value={props.draft.horizonDays}
                  min={1}
                  max={365}
                  units={RANGE_DAY_UNITS}
                  compact
                  controls={false}
                  disabled={props.disabled}
                  error={error('horizonDays')}
                  errorId={toErrorId}
                  onChange={(value) => update('horizonDays', value)}
                />
              </div>
            </div>
            <div class="min-w-0" data-booking-range-timeline>
              <Slider.Track
                class="my-2"
                onPointerDown={beginPointer}
                onPointerMove={movePointer}
                onPointerUp={finishDrag}
                onPointerCancel={finishDrag}
                onLostPointerCapture={finishDrag}
              >
                <Slider.Fill />
                <Slider.Thumb
                  aria-label="Earliest booking time"
                  aria-valuemin={0}
                  aria-valuemax={10080}
                  aria-valuenow={earliest()}
                  aria-valuetext={describeNotice()}
                  aria-invalid={error('noticeMinutes') ? true : undefined}
                  aria-disabled={props.disabled ? true : undefined}
                  aria-describedby={
                    error('noticeMinutes') ? fromErrorId : undefined
                  }
                  onKeyDown={(event) => keyboard('noticeMinutes', event)}
                  onPointerDown={(event) => {
                    beginPointer(event);
                    pointerIntent.thumbDown(event);
                    setDragging('noticeMinutes');
                  }}
                  onPointerEnter={() => setHovered('noticeMinutes')}
                  onPointerLeave={() => setHovered(undefined)}
                  onFocus={() => setFocused('noticeMinutes')}
                  onBlur={() => setFocused(undefined)}
                  onPointerMove={movePointer}
                  onPointerUp={finishDrag}
                  onPointerCancel={finishDrag}
                  onLostPointerCapture={finishDrag}
                  class="border-2 border-ink bg-ink"
                >
                  <Tooltip
                    label={describeNotice()}
                    open={tooltipVisible('noticeMinutes')}
                    disabled={props.disabled}
                    as="span"
                    class="absolute inset-0"
                  >
                    <span aria-hidden="true" class="block size-full" />
                  </Tooltip>
                </Slider.Thumb>
                <Slider.Thumb
                  aria-label="Latest booking time"
                  aria-valuemin={1}
                  aria-valuemax={SLIDER_MAX_DAYS}
                  aria-valuenow={latest()}
                  aria-valuetext={horizonLabel()}
                  aria-invalid={error('horizonDays') ? true : undefined}
                  aria-disabled={props.disabled ? true : undefined}
                  aria-describedby={
                    error('horizonDays') ? toErrorId : undefined
                  }
                  onKeyDown={(event) => keyboard('horizonDays', event)}
                  onPointerDown={(event) => {
                    beginPointer(event);
                    pointerIntent.thumbDown(event);
                    setDragging('horizonDays');
                  }}
                  onPointerEnter={() => setHovered('horizonDays')}
                  onPointerLeave={() => setHovered(undefined)}
                  onFocus={() => setFocused('horizonDays')}
                  onBlur={() => setFocused(undefined)}
                  onPointerMove={movePointer}
                  onPointerUp={finishDrag}
                  onPointerCancel={finishDrag}
                  onLostPointerCapture={finishDrag}
                  class="border-2 border-ink bg-ink"
                >
                  <Tooltip
                    label={horizonLabel()}
                    open={tooltipVisible('horizonDays')}
                    disabled={props.disabled}
                    as="span"
                    class="absolute inset-0"
                  >
                    <span aria-hidden="true" class="block size-full" />
                  </Tooltip>
                </Slider.Thumb>
              </Slider.Track>
              <div
                class="relative h-4 text-[10px] text-ink-muted"
                aria-hidden="true"
              >
                <For each={RANGE_MARKS}>
                  {(mark) => (
                    <span
                      class="absolute -translate-x-1/2 rtl:translate-x-1/2"
                      style={{
                        'inset-inline-start': `${bookingTimelinePosition(mark.value, BOOKING_RANGE_TIMELINE)}%`,
                      }}
                    >
                      {mark.label}
                    </span>
                  )}
                </For>
              </div>
            </div>
          </div>
        </Slider>
      </div>
    </section>
  );
}
