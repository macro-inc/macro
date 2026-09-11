import type { DateDisplayMode } from '@macro-inc/lexical-core';
import { formatDistanceStrict } from 'date-fns';
import { formatDate, formatRelativeDay } from './dateParser';

export type { DateDisplayMode };

/**
 * Label for a date mention chip. Countdown/duration labels are relative to `now`
 * so the decorator can tick them without writing the node.
 */
export function formatDateMentionLabel(
  date: Date,
  displayMode?: DateDisplayMode | null,
  now: Date = new Date()
): string {
  if (Number.isNaN(date.getTime())) return '';

  switch (displayMode) {
    case 'date':
      return formatDate(date);
    case 'countdown':
      return formatDistanceStrict(date, now, { addSuffix: true });
    case 'duration': {
      if (date.getTime() <= now.getTime()) return '0 minutes';
      return formatDistanceStrict(date, now);
    }
    default:
      return formatRelativeDay(date);
  }
}
