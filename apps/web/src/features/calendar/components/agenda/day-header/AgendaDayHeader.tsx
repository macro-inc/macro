import { formatLocale } from '@app/lib/i18n';
import { cn, Layer } from '@ui';
import { format } from 'date-fns';

export function AgendaDayHeader(props: { date: Date }) {
  const today = () =>
    format(props.date, 'yyyy-MM-dd') === format(new Date(), 'yyyy-MM-dd');

  return (
    <Layer offset={0}>
      <h2 class="sticky top-0 z-10 flex flex-col border-b border-edge bg-surface px-5 py-3 text-sm font-semibold text-ink">
        <span>
          {props.date.toLocaleDateString(formatLocale(), { weekday: 'long' })}
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
      </h2>
    </Layer>
  );
}
