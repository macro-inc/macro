import type { ClockFormat } from '@app/components/date-time-range/primitives/clock-format';
import { whenSummary } from './when-summary';

export function desktopDateSummary(
  start: string,
  end: string,
  allDay: boolean,
  format: ClockFormat,
  locale?: string
) {
  return whenSummary(start, end, allDay, format, locale, ', ');
}

export function desktopSummaryDetails(...parts: (string | undefined)[]) {
  return parts.filter((part) => part !== undefined && part !== '').join(', ');
}
