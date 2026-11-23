/** How long a call has been running: `4:05`, or `1h 12m` past an hour. */
export function formatCallElapsed(
  startedAt: string | undefined,
  nowMs: number
) {
  const startedAtMs = startedAt ? new Date(startedAt).getTime() : Number.NaN;
  if (!Number.isFinite(startedAtMs)) return '';

  const totalSeconds = Math.max(0, Math.floor((nowMs - startedAtMs) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}
