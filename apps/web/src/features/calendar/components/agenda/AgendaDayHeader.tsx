import { formatLocale } from '@app/lib/i18n';
import { cn, Layer } from '@ui';
import { format, isSameDay } from 'date-fns';
import { Show } from 'solid-js';

export function AgendaDayHeader(props: { date: Date; end?: Date }) {
  const today = () => isSameDay(props.date, new Date());
  const rangeEnd = () =>
    props.end && !isSameDay(props.date, props.end) ? props.end : undefined;

  return (
    <Layer offset={0}>
      <h2 class="sticky top-0 z-10 flex flex-col border-b border-edge bg-surface px-5 py-3 text-sm font-semibold text-ink">
        <Show
          when={rangeEnd()}
          fallback={
            <>
              <span>
                {props.date.toLocaleDateString(formatLocale(), {
                  weekday: 'long',
                })}
              </span>
              <time
                dateTime={format(props.date, 'yyyy-MM-dd')}
                class={cn(today() && 'text-accent')}
              >
                {props.date.toLocaleDateString(formatLocale(), {
                  month: 'short',
                  day: 'numeric',
                })}
              </time>
            </>
          }
        >
          {(end) =>
            new Intl.DateTimeFormat(formatLocale(), {
              weekday: 'short',
              month: 'short',
              day: 'numeric',
            }).formatRange(props.date, end())
          }
        </Show>
      </h2>
    </Layer>
  );
}
