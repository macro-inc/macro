import { formatLocale, t } from '@app/lib/i18n';
import { cn } from '@ui';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "now", "4m", "3h", "2d", then a weekday or date. */
export function formatAge(at: number, now: number): string {
  const age = Math.max(0, now - at);
  if (age < MINUTE) return t('board.now');
  const unit = (value: number, name: 'minute' | 'hour' | 'day') =>
    new Intl.NumberFormat(formatLocale(), {
      style: 'unit',
      unit: name,
      unitDisplay: 'narrow',
    }).format(value);
  if (age < HOUR) return unit(Math.floor(age / MINUTE), 'minute');
  if (age < DAY) return unit(Math.floor(age / HOUR), 'hour');
  if (age < 7 * DAY) return unit(Math.floor(age / DAY), 'day');
  return new Intl.DateTimeFormat(formatLocale(), {
    month: 'short',
    day: 'numeric',
  }).format(at);
}

/** A compact relative time with the exact time on hover. */
export function AgeLabel(props: { at: number; now: number; class?: string }) {
  return (
    <time
      datetime={new Date(props.at).toISOString()}
      title={new Intl.DateTimeFormat(formatLocale(), {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(props.at)}
      class={cn('shrink-0 tabular-nums', props.class)}
    >
      {formatAge(props.at, props.now)}
    </time>
  );
}
