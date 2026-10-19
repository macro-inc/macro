import { createUniqueId, type JSX } from 'solid-js';
import { MINUTE_UNITS } from '../core/booking-units';
import type { EventType, EventValidationIssue } from '../core/types';
import { BookingFieldInfo } from './booking-field-info';
import { BookingRange } from './booking-range';
import { BookingRulePresets } from './booking-rule-value';
import { BookingValueInput } from './booking-value-input';

const BUFFER_UNITS = MINUTE_UNITS.slice(0, 1);

function RuleLabel(props: {
  label: string;
  description: string;
  children?: JSX.Element;
}) {
  return (
    <div class="flex min-w-0 items-center gap-1.5">
      <span class="text-sm font-normal text-ink-muted">{props.label}</span>
      <BookingFieldInfo label={props.label} description={props.description} />
      {props.children}
    </div>
  );
}

export function BookingRules(props: {
  draft: EventType;
  disabled: boolean;
  onUpdate: <K extends keyof EventType>(key: K, value: EventType[K]) => void;
  issues?: EventValidationIssue[];
  onBuffers: (before: number, after: number) => void;
  onDailyLimitEnabled: (enabled: boolean) => void;
}) {
  const beforeId = createUniqueId();
  const afterId = createUniqueId();
  const error = (field: EventValidationIssue['field']) =>
    props.issues?.find((issue) => issue.field === field)?.message;
  const update = <K extends keyof EventType>(key: K, value: EventType[K]) => {
    if (!props.disabled) props.onUpdate(key, value);
  };
  const before = (value: number) => {
    if (!props.disabled) props.onBuffers(value, props.draft.afterMinutes);
  };
  const after = (value: number) => {
    if (!props.disabled) props.onBuffers(props.draft.beforeMinutes, value);
  };
  return (
    <fieldset
      disabled={props.disabled}
      class="flex min-w-0 flex-col gap-8"
      data-booking-rules-visual
      onKeyDown={(event) => {
        // Exact-value editing never advances or saves the enclosing form on Enter.
        if (event.key === 'Enter' && event.target instanceof HTMLInputElement) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
    >
      <legend class="sr-only">Booking rules</legend>
      <BookingRange
        draft={props.draft}
        disabled={props.disabled}
        issues={props.issues}
        onUpdate={props.onUpdate}
      />
      <section
        aria-label="Booking frequency"
        class="flex min-w-0 flex-col gap-8"
      >
        <div
          role="group"
          aria-label="Time-slot interval"
          class="flex min-w-0 flex-col gap-2"
        >
          <RuleLabel
            label="Time-slot interval"
            description="Spacing between the meeting start times guests can choose."
          />
          <BookingRulePresets
            label="Time-slot interval"
            value={props.draft.intervalMinutes}
            min={5}
            max={480}
            units={BUFFER_UNITS}
            disabled={props.disabled}
            error={error('intervalMinutes')}
            presets={[5, 10, 15, 20, 30, 45, 60].map((value) => ({
              value,
              label: `${value} mins`,
            }))}
            onChange={(value) => update('intervalMinutes', value)}
          />
        </div>
        <div
          role="group"
          aria-label="Daily booking limit"
          class="flex min-w-0 flex-col gap-2"
        >
          <RuleLabel
            label="Daily booking limit"
            description="The maximum meetings guests can book each day."
          />
          <BookingRulePresets
            label="Daily booking limit"
            value={props.draft.dailyLimit ?? 0}
            min={0}
            max={100}
            units={[
              {
                id: 'bookings',
                label: 'Bookings',
                short: 'bookings',
                factor: 1,
              },
            ]}
            disabled={props.disabled}
            error={error('dailyLimit')}
            presets={[
              { value: 0, label: 'No limit' },
              ...[1, 3, 5, 10, 20].map((value) => ({
                value,
                label: String(value),
              })),
            ]}
            onChange={(value) => {
              if (props.disabled) return;
              if (value === 0) props.onDailyLimitEnabled(false);
              else props.onUpdate('dailyLimit', value);
            }}
          />
        </div>
      </section>
      <section
        aria-label="Time between meetings"
        class="flex min-w-0 flex-col gap-3"
      >
        <RuleLabel
          label="Time between meetings"
          description="Add time before a meeting to prepare or after one to take a break."
        />
        <div class="grid min-w-0 grid-cols-2 gap-x-6 gap-y-4 sm:gap-x-8">
          <div class="flex min-w-0 flex-col gap-1.5">
            <label for={beforeId} class="text-sm font-normal text-ink-muted">
              Before each meeting
            </label>
            <BookingValueInput
              label="Before each meeting"
              inputId={beforeId}
              value={props.draft.beforeMinutes}
              min={0}
              max={10080}
              units={BUFFER_UNITS}
              compact
              disabled={props.disabled}
              error={error('beforeMinutes')}
              onChange={before}
            />
          </div>
          <div class="flex min-w-0 flex-col gap-1.5">
            <label for={afterId} class="text-sm font-normal text-ink-muted">
              After each meeting
            </label>
            <BookingValueInput
              label="After each meeting"
              inputId={afterId}
              value={props.draft.afterMinutes}
              min={0}
              max={10080}
              units={BUFFER_UNITS}
              compact
              disabled={props.disabled}
              error={error('afterMinutes')}
              onChange={after}
            />
          </div>
        </div>
      </section>
    </fieldset>
  );
}
