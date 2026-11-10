import { formatLocale, t } from '@app/lib/i18n';
import { For, Show } from 'solid-js';
import type { DayEvent, DayStrip } from '../core/day';

function hourLabel(hour: number) {
  const time = new Date();
  time.setHours(hour, 0, 0, 0);

  return new Intl.DateTimeFormat(formatLocale(), { hour: 'numeric' })
    .format(time)
    .replace(/\s/g, '')
    .toLowerCase();
}

/** Today as one quiet strip of working hours: neutral chips, a thin now line. */
export function TodayTimeline(props: {
  date: Date;
  strip: DayStrip;
  onOpen(event: DayEvent): void;
}) {
  const span = () =>
    (props.strip.hours.at(-1) ?? 0) - (props.strip.hours[0] ?? 0);

  return (
    <section aria-label={t('ideas.today')} data-home-today>
      <h2 class="flex items-baseline gap-2 px-1 text-sm font-medium text-ink">
        {t('ideas.today')}
        <span class="text-xs font-normal text-ink-extra-muted">
          {new Intl.DateTimeFormat(formatLocale(), {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
          }).format(props.date)}
        </span>
      </h2>
      <Show
        when={props.strip.chips.length > 0}
        fallback={
          <p class="mt-3 px-1 text-sm text-ink-extra-muted">
            {t('ideas.todayEmpty')}
          </p>
        }
      >
        <div class="relative mt-3 h-27">
          <For each={props.strip.hours}>
            {(hour) => (
              <div
                class="absolute inset-y-0 border-l border-edge-divider first:border-transparent"
                style={{
                  left: `${((hour - (props.strip.hours[0] ?? 0)) / span()) * 100}%`,
                }}
              >
                <span class="absolute top-0 -translate-x-1/2 text-[11px] text-ink-extra-muted first:translate-x-0">
                  {hourLabel(hour)}
                </span>
              </div>
            )}
          </For>
          <Show when={props.strip.now !== undefined}>
            <div
              class="absolute top-5 bottom-0 w-px bg-accent"
              style={{ left: `${props.strip.now}%` }}
              aria-hidden="true"
            />
          </Show>
          <ul class="m-0 list-none p-0">
            <For each={props.strip.chips}>
              {(chip) => (
                <li
                  class="absolute max-w-[28%]"
                  style={{
                    left: `min(${chip.left}%, 72%)`,
                    top: `${1.75 + chip.lane * 2.5}rem`,
                  }}
                >
                  <button
                    type="button"
                    class="block max-w-full truncate rounded-md border border-edge-muted bg-panel px-2 py-1 text-xs text-ink outline-none not-touch:hover:bg-hover focus-visible:ring-2 focus-visible:ring-edge-focus"
                    classList={{ 'text-ink-extra-muted': chip.past }}
                    aria-label={t('ideas.openEvent', {
                      title: chip.event.title,
                    })}
                    onClick={() => props.onOpen(chip.event)}
                  >
                    {chip.event.title}
                  </button>
                </li>
              )}
            </For>
          </ul>
        </div>
      </Show>
    </section>
  );
}
