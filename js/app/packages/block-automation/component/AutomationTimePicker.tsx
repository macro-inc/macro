import clickOutside from '@core/directive/clickOutside';
import { cn } from '@ui/utils/classname';
import { createEffect, createSignal, on, Show } from 'solid-js';
import { INPUT_CLASS, isValidTime } from './automationUtils';

false && clickOutside;

function parseHHMM(value: string): {
  hour: number;
  minute: number;
  period: 'AM' | 'PM';
} {
  if (!isValidTime(value)) return { hour: 9, minute: 0, period: 'AM' };
  const [h, m] = value.split(':').map(Number);
  return {
    hour: h % 12 || 12,
    minute: m,
    period: h >= 12 ? 'PM' : 'AM',
  };
}

function formatTimeLabel(value: string) {
  if (!isValidTime(value)) return '—';
  const [h, m] = value.split(':').map(Number);
  const date = new Date(2026, 0, 1, h, m);
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function toHHMM(hour12: number, minute: number, period: 'AM' | 'PM') {
  const h24 =
    period === 'AM'
      ? hour12 === 12
        ? 0
        : hour12
      : hour12 === 12
        ? 12
        : hour12 + 12;
  return `${String(h24).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

export function AutomationTimePicker(props: {
  value: string;
  onChange: (hhmm: string) => void;
}) {
  const [open, setOpen] = createSignal(false);

  const initial = parseHHMM(props.value);
  const [hour, setHour] = createSignal(initial.hour);
  const [hourDisplay, setHourDisplay] = createSignal(initial.hour.toString());
  const [minute, setMinute] = createSignal(initial.minute);
  const [minuteDisplay, setMinuteDisplay] = createSignal(
    initial.minute.toString().padStart(2, '0')
  );
  const [period, setPeriod] = createSignal<'AM' | 'PM'>(initial.period);

  createEffect(
    on(
      () => props.value,
      (value) => {
        const p = parseHHMM(value);
        setHour(p.hour);
        setHourDisplay(p.hour.toString());
        setMinute(p.minute);
        setMinuteDisplay(p.minute.toString().padStart(2, '0'));
        setPeriod(p.period);
      },
      { defer: true }
    )
  );

  const commit = (
    nextHour: number,
    nextMinute: number,
    nextPeriod: 'AM' | 'PM'
  ) => {
    props.onChange(toHHMM(nextHour, nextMinute, nextPeriod));
  };

  return (
    <div class="relative">
      <button
        type="button"
        class={cn(INPUT_CLASS, 'text-left')}
        onClick={() => setOpen((v) => !v)}
      >
        {formatTimeLabel(props.value)}
      </button>
      <Show when={open()}>
        <div
          class="absolute left-0 right-0 top-full mt-1 z-action-menu bg-dialog border border-edge-muted rounded-sm p-3"
          use:clickOutside={() => setOpen(false)}
        >
          <div class="flex items-center gap-2">
            <div class="flex items-center gap-1">
              <input
                type="text"
                inputmode="numeric"
                maxLength={2}
                aria-label="Hour"
                class="w-10 text-center bg-active border border-edge-muted rounded-sm px-1 py-1 text-sm focus:outline-none focus:border-accent"
                value={hourDisplay()}
                onKeyDown={(e) => {
                  if (e.key.length === 1 && !/\d/.test(e.key)) {
                    e.preventDefault();
                  }
                }}
                onInput={(e) => {
                  const raw = e.currentTarget.value;
                  setHourDisplay(raw);
                  const val = parseInt(raw);
                  if (!isNaN(val) && val >= 1 && val <= 12) {
                    setHour(val);
                    commit(val, minute(), period());
                  }
                }}
                onBlur={() => setHourDisplay(hour().toString())}
              />
              <span class="text-sm font-medium">:</span>
              <input
                type="text"
                inputmode="numeric"
                maxLength={2}
                aria-label="Minute"
                class="w-10 text-center bg-active border border-edge-muted rounded-sm px-1 py-1 text-sm focus:outline-none focus:border-accent"
                value={minuteDisplay()}
                onKeyDown={(e) => {
                  if (e.key.length === 1 && !/\d/.test(e.key)) {
                    e.preventDefault();
                  }
                }}
                onInput={(e) => {
                  const raw = e.currentTarget.value;
                  setMinuteDisplay(raw);
                  const val = parseInt(raw);
                  if (!isNaN(val) && val >= 0 && val <= 59) {
                    setMinute(val);
                    commit(hour(), val, period());
                  }
                }}
                onBlur={() =>
                  setMinuteDisplay(minute().toString().padStart(2, '0'))
                }
              />
            </div>
            <div class="flex border border-edge-muted rounded-sm text-sm overflow-hidden">
              <button
                type="button"
                class="px-2 py-1 transition-colors"
                classList={{
                  'bg-accent text-dialog': period() === 'AM',
                  'hover:bg-active': period() !== 'AM',
                }}
                onClick={() => {
                  setPeriod('AM');
                  commit(hour(), minute(), 'AM');
                }}
              >
                AM
              </button>
              <button
                type="button"
                class="px-2 py-1 transition-colors"
                classList={{
                  'bg-accent text-dialog': period() === 'PM',
                  'hover:bg-active': period() !== 'PM',
                }}
                onClick={() => {
                  setPeriod('PM');
                  commit(hour(), minute(), 'PM');
                }}
              >
                PM
              </button>
            </div>
            <button
              type="button"
              class="ml-auto px-2 py-1 border border-accent/30 bg-accent/10 text-accent rounded-sm text-sm hover:bg-accent/20"
              onClick={() => setOpen(false)}
            >
              Done
            </button>
          </div>
        </div>
      </Show>
    </div>
  );
}
