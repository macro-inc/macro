import { getDefaultTimezone } from '@core/util/cron';

/** Compact exact time; presentation only, never used to rebuild a schedule. */
export function formatReminderOccurrence(
  value: Date | string,
  timezone = getDefaultTimezone(),
  viewerTimezone = getDefaultTimezone()
): string | undefined {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return;
  try {
    const calendar = new Intl.DateTimeFormat(undefined, {
      timeZone: timezone,
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
    const viewer = new Intl.DateTimeFormat(undefined, {
      timeZone: viewerTimezone,
    });
    const wallTime = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    // A fall-back hour can name two instants even in the viewer's own zone.
    const local = wallTime.format(date);
    const repeated = [-180, -120, -90, -60, -30, 30, 60, 90, 120, 180].some(
      (minutes) =>
        wallTime.format(new Date(date.getTime() + minutes * 60_000)) === local
    );
    const showZone =
      repeated ||
      calendar.resolvedOptions().timeZone !== viewer.resolvedOptions().timeZone;
    const time = new Intl.DateTimeFormat(undefined, {
      timeZone: timezone,
      hour: 'numeric',
      minute: '2-digit',
      second: date.getUTCSeconds() ? '2-digit' : undefined,
      timeZoneName: showZone ? 'short' : undefined,
    }).format(date);
    return `${calendar.format(date)} at ${time}`;
  } catch {
    return;
  }
}
