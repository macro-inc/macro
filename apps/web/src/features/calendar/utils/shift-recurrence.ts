const WEEKDAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];

/**
 * Translate the supported raw rules without a lossy editor parse/serialize cycle.
 * Moving a weekly rule also moves its week boundary, so multiweek groups stay
 * together. More complex date filters need provider-side recurrence rewriting.
 */
export function shiftRecurrenceDays(
  lines: string[],
  days: number,
  startChanged: boolean
): string[] | undefined {
  if (!startChanged) return lines;
  if (lines.length !== 1 || !lines[0].startsWith('RRULE:')) return undefined;
  const parts = lines[0]
    .slice(6)
    .split(';')
    .map((part) => part.split('='));
  const fields = new Map(parts.map(([key, value]) => [key, value]));
  if (fields.size !== parts.length || parts.some((part) => part.length !== 2))
    return undefined;
  const frequency = fields.get('FREQ');
  if (frequency !== 'DAILY' && frequency !== 'WEEKLY') return undefined;
  if (
    parts.some(
      ([key]) => !['FREQ', 'INTERVAL', 'COUNT', 'BYDAY', 'WKST'].includes(key)
    )
  )
    return undefined;
  for (const key of ['INTERVAL', 'COUNT']) {
    const value = fields.get(key);
    if (value !== undefined && !/^[1-9]\d*$/.test(value)) return undefined;
  }
  if (days === 0) return lines;
  const rotate = (day: string) => {
    const index = WEEKDAYS.indexOf(day);
    return index < 0 ? undefined : WEEKDAYS[(((index + days) % 7) + 7) % 7];
  };
  const byDay = fields.get('BYDAY');
  if (byDay) {
    const shifted = byDay.split(',').map(rotate);
    if (shifted.some((day) => day === undefined)) return undefined;
    fields.set('BYDAY', shifted.join(','));
  }
  const weekStart = rotate(fields.get('WKST') ?? 'MO');
  if (!weekStart) return undefined;
  if (frequency === 'WEEKLY') fields.set('WKST', weekStart);
  return [
    `RRULE:${Array.from(fields, ([key, value]) => `${key}=${value}`).join(';')}`,
  ];
}
