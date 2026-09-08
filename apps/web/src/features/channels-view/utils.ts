import type { DateValue } from '@core/util/date';

export function channelInitials(name: string) {
  const words = name.replace(/^#+/, '').trim().split(/\s+/).filter(Boolean);

  if (words.length === 0) return '?';

  return words
    .slice(0, 2)
    .map((word) => word[0])
    .join('')
    .toLocaleUpperCase();
}

export function formatDetailedTimestamp(timestamp: DateValue) {
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
  if (Number.isNaN(date.getTime())) return String(timestamp);

  return date.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}
