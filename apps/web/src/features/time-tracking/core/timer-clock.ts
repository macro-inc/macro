/** Whole seconds a timer started at `startedAt` has run at `nowMs`. */
export function elapsedSeconds(startedAt: string, nowMs: number): number {
  return Math.max(0, Math.floor((nowMs - Date.parse(startedAt)) / 1000));
}

/**
 * How far the server's clock is ahead of this device's, in milliseconds,
 * from the server's time in a reply this device received at `receivedAtMs`.
 */
export function serverOffset(serverNow: string, receivedAtMs: number): number {
  const server = Date.parse(serverNow);
  return Number.isNaN(server) ? 0 : server - receivedAtMs;
}

function twoDigits(value: number): string {
  return String(value).padStart(2, '0');
}

/** A running count with hours: `0:42:10`. */
export function formatClock(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours}:${twoDigits(minutes)}:${twoDigits(seconds % 60)}`;
}

/** A running count for tight spaces: `42:10` under an hour, `1:42:10` from one. */
export function formatCompactClock(seconds: number): string {
  if (seconds >= 3600) return formatClock(seconds);
  return `${Math.floor(seconds / 60)}:${twoDigits(seconds % 60)}`;
}
