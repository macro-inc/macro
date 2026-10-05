import { parseTime, useDateSearch } from '@core/util/dateSearch/useDateSearch';
import { type Accessor, createMemo } from 'solid-js';
import type { ReminderTimeOption } from '../core/email-reminder';
import {
  REMINDER_DEFAULT_TIME,
  reminderQuickPresets,
} from '../reminder-schedule';

/** Resolve typed times once per query, rejecting past times and DST gaps. */
export function createReminderTimeOptions(query: Accessor<string>) {
  const now = new Date();
  const presets = reminderQuickPresets(now);
  const dates = useDateSearch({
    query,
    baseDate: now,
    defaultTime: REMINDER_DEFAULT_TIME,
  });
  return createMemo<readonly ReminderTimeOption[]>(() => {
    const search = query().trim().toLowerCase();
    if (!search) return presets;
    const wallTime = parseTime(search)?.time;
    const parsed = dates()
      .filter(
        ({ date }) =>
          date.getTime() > Date.now() &&
          (!wallTime ||
            (date.getHours() === wallTime.hours &&
              date.getMinutes() === wallTime.minutes))
      )
      .map(({ id, date, displayText }) => ({ id, date, label: displayText }));
    const seen = new Set<number>();
    return [
      ...presets.filter((preset) =>
        preset.label.toLowerCase().includes(search)
      ),
      ...parsed,
    ].filter(({ date }) => {
      if (seen.has(date.getTime())) return false;
      seen.add(date.getTime());
      return true;
    });
  });
}
