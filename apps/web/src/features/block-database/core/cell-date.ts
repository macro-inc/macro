import type { DatabaseCellValue } from './database-view';

/** A date cell stores its calendar day as UTC midnight (RFC 3339). */
export function toCellDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}T00:00:00.000Z`;
}

/** The stored calendar day as a local date, for pickers that work locally. */
export function fromCellDate(value: DatabaseCellValue): Date | null {
  const match =
    typeof value === 'string' ? /^(\d{4})-(\d{2})-(\d{2})/.exec(value) : null;
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}
