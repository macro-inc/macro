/**
 * Native date inputs speak local wall-clock strings; a Date cell holds an
 * instant. A date-and-time answer is the respondent's local time; a date
 * answer is that day at midnight UTC, so it reads as the same day everywhere.
 */

const pad = (value: number) => String(value).padStart(2, '0');

/** `datetime-local` value → ISO instant, or undefined when incomplete. */
export function instantFromLocalInput(value: string): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

/** ISO instant → `datetime-local` value in the browser's zone. */
export function localInputFromInstant(instant: string): string {
  const date = new Date(instant);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** `date` value (`YYYY-MM-DD`) → that day at midnight UTC. */
export function instantFromDateInput(value: string): string | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

/** ISO instant → `date` value, read in UTC. */
export function dateInputFromInstant(instant: string): string {
  const date = new Date(instant);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

/** How a receipt shows a date answer. */
export function displayDate(instant: string, withTime: boolean): string {
  const date = new Date(instant);
  if (Number.isNaN(date.getTime())) return instant;
  return withTime
    ? date.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'UTC',
      });
}
