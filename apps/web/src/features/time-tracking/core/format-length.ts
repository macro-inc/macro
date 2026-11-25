/**
 * A length of logged time, in whole minutes, as people read it: `4h 35m`,
 * `45m`, `2h`.
 */
export function formatLength(minutes: number): string {
  const whole = Math.max(0, Math.round(minutes));
  const hours = Math.floor(whole / 60);
  const rest = whole % 60;
  if (hours === 0) return `${rest}m`;
  if (rest === 0) return `${hours}h`;
  return `${hours}h ${rest}m`;
}
