import { type Accessor, createMemo } from 'solid-js';
import type { ParsedTime } from './parseTime';
import { useDateSearch } from './useDateSearch';

export type TimeOption = { id: string; label: string; date: Date };

/**
 * Choices for a menu that picks a future instant, such as a reminder or a
 * scheduled send: `presets` until the user types, then the presets whose
 * label matches followed by the parsed times. Each instant appears once.
 */
export function createTimeOptions(params: {
  query: Accessor<string>;
  defaultTime: ParsedTime;
  presets: (now: Date) => readonly TimeOption[];
}): Accessor<readonly TimeOption[]> {
  const dates = useDateSearch({
    query: params.query,
    defaultTime: params.defaultTime,
    futureOnly: true,
  });
  return createMemo(() => {
    const search = params.query().trim().toLowerCase();
    const presets = params.presets(new Date());
    if (!search) return presets;
    const seen = new Set<number>();
    return [
      ...presets.filter((preset) =>
        preset.label.toLowerCase().includes(search)
      ),
      ...dates().map(({ id, date, displayText }) => ({
        id,
        date,
        label: displayText,
      })),
    ].filter(({ date }) => {
      if (seen.has(date.getTime())) return false;
      seen.add(date.getTime());
      return true;
    });
  });
}
