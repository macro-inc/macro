/**
 * How long ago something moved, at the width a list row can spare: `now`,
 * `4m`, `3h`, `2d`, then a short date. Empty when the time is unknown.
 * Pass the interface locale on translated surfaces; legacy callers keep English.
 */
export function compactAge(
  timestamp: number,
  now = Date.now(),
  locale = 'en-US'
): string {
  if (!timestamp) return '';
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
  if (seconds < 60) {
    return new Intl.RelativeTimeFormat(locale, {
      numeric: 'auto',
      style: 'narrow',
    }).format(0, 'second');
  }
  const minutes = Math.round(seconds / 60);
  const hours = Math.round(minutes / 60);
  const days = Math.round(hours / 24);
  if (days >= 7) {
    return new Date(timestamp).toLocaleDateString(locale, {
      month: 'short',
      day: 'numeric',
    });
  }

  let value = days;
  let unit = 'day';
  if (minutes < 60) {
    value = minutes;
    unit = 'minute';
  } else if (hours < 24) {
    value = hours;
    unit = 'hour';
  }
  return new Intl.NumberFormat(locale, {
    style: 'unit',
    unit,
    unitDisplay: 'narrow',
  }).format(value);
}

/** The sentence form for card footers: `just now`, `4 min ago`, `3 h ago`, `2 d ago`. */
export function relativeAge(timestamp: number, now = Date.now()): string {
  if (!timestamp) return '';
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} d ago`;
  return new Date(timestamp).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}
