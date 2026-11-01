import { addDays, addWeeks, endOfDay, endOfWeek, nextDay } from 'date-fns';
import type { ParsedTime } from './parseTime';

interface DatePreset {
  id: string;
  label: string;
  shortLabel?: string;
  keywords: string[];
  getDate: (baseDate?: Date) => Date;
  /** A time of day the preset names, kept unless the query names one. */
  time?: ParsedTime;
  /** Weekday and time-of-day presets appear only when searched for. */
  category?: 'quick' | 'week' | 'month' | 'year' | 'weekday' | 'time';
}

function getNextWeekday(weekday: 0 | 1 | 2 | 3 | 4 | 5 | 6, baseDate: Date) {
  const today = baseDate.getDay();
  if (today === weekday) {
    return addDays(endOfDay(baseDate), 7);
  }
  return endOfDay(nextDay(baseDate, weekday));
}

const DATE_PRESETS: DatePreset[] = [
  {
    id: 'today',
    label: 'Today',
    shortLabel: 'Today',
    keywords: ['today', 'tod'],
    getDate: (baseDate = new Date()) => endOfDay(baseDate),
    category: 'quick',
  },
  {
    id: 'end-of-day',
    label: 'End of day',
    shortLabel: 'EOD',
    keywords: ['end of day', 'eod'],
    getDate: (baseDate = new Date()) => endOfDay(baseDate),
    time: { hours: 17, minutes: 0 },
    category: 'time',
  },
  {
    id: 'tomorrow',
    label: 'Tomorrow',
    shortLabel: 'Tom',
    keywords: ['tomorrow', 'tmrw', 'tmr', 'tom', 'tomorow', 'tomoro', 'tmro'],
    getDate: (baseDate = new Date()) => addDays(endOfDay(baseDate), 1),
    category: 'quick',
  },
  {
    id: 'yesterday',
    label: 'Yesterday',
    shortLabel: 'Yest',
    keywords: ['yesterday', 'yest', 'ystrdy', 'yday'],
    getDate: (baseDate = new Date()) => addDays(endOfDay(baseDate), -1),
    category: 'quick',
  },
  {
    id: 'in-2-days',
    label: 'In 2 days',
    shortLabel: '2d',
    keywords: ['2 days', '2d', 'two days'],
    getDate: (baseDate = new Date()) => addDays(endOfDay(baseDate), 2),
    category: 'quick',
  },
  {
    id: 'end-of-week',
    label: 'End of week',
    shortLabel: 'EOW',
    keywords: ['end of week', 'eow', 'weekend'],
    getDate: (baseDate = new Date()) =>
      endOfWeek(baseDate, { weekStartsOn: 1 }),
    category: 'week',
  },
  {
    id: 'in-1-week',
    label: 'In 1 week',
    shortLabel: '1w',
    keywords: ['1 week', '1w', 'one week', 'week'],
    getDate: (baseDate = new Date()) => addWeeks(baseDate, 1),
    category: 'week',
  },
  {
    id: 'in-2-weeks',
    label: 'In 2 weeks',
    shortLabel: '2w',
    keywords: ['2 weeks', '2w', 'two weeks', 'fortnight'],
    getDate: (baseDate = new Date()) => addWeeks(baseDate, 2),
    category: 'week',
  },
  {
    id: 'monday',
    label: 'Monday',
    shortLabel: 'Mon',
    keywords: ['monday', 'mon', 'mndy'],
    getDate: (baseDate = new Date()) => getNextWeekday(1, baseDate),
    category: 'weekday',
  },
  {
    id: 'tuesday',
    label: 'Tuesday',
    shortLabel: 'Tue',
    keywords: ['tuesday', 'tue', 'tues', 'tu'],
    getDate: (baseDate = new Date()) => getNextWeekday(2, baseDate),
    category: 'weekday',
  },
  {
    id: 'wednesday',
    label: 'Wednesday',
    shortLabel: 'Wed',
    keywords: ['wednesday', 'wed', 'weds', 'wednes'],
    getDate: (baseDate = new Date()) => getNextWeekday(3, baseDate),
    category: 'weekday',
  },
  {
    id: 'thursday',
    label: 'Thursday',
    shortLabel: 'Thu',
    keywords: ['thursday', 'thu', 'thur', 'thurs'],
    getDate: (baseDate = new Date()) => getNextWeekday(4, baseDate),
    category: 'weekday',
  },
  {
    id: 'friday',
    label: 'Friday',
    shortLabel: 'Fri',
    keywords: ['friday', 'fri'],
    getDate: (baseDate = new Date()) => getNextWeekday(5, baseDate),
    category: 'weekday',
  },
  {
    id: 'saturday',
    label: 'Saturday',
    shortLabel: 'Sat',
    keywords: ['saturday', 'sat'],
    getDate: (baseDate = new Date()) => getNextWeekday(6, baseDate),
    category: 'weekday',
  },
  {
    id: 'sunday',
    label: 'Sunday',
    shortLabel: 'Sun',
    keywords: ['sunday', 'sun'],
    getDate: (baseDate = new Date()) => getNextWeekday(0, baseDate),
    category: 'weekday',
  },
  {
    id: 'next-week',
    label: 'Next week',
    shortLabel: 'NW',
    keywords: ['next week', 'nw'],
    getDate: (baseDate = new Date()) => getNextWeekday(1, baseDate),
    category: 'weekday',
  },
];

export type { DatePreset };

export function searchPresets(query: string): DatePreset[] {
  const normalizedQuery = query.toLowerCase().trim();

  if (!normalizedQuery) {
    return DATE_PRESETS.filter(
      (p) => p.category !== 'weekday' && p.category !== 'time'
    );
  }

  return DATE_PRESETS.filter((preset) => {
    if (preset.label.toLowerCase().includes(normalizedQuery)) {
      return true;
    }

    if (preset.shortLabel?.toLowerCase().includes(normalizedQuery)) {
      return true;
    }

    return preset.keywords.some(
      (keyword) =>
        keyword.toLowerCase().includes(normalizedQuery) ||
        normalizedQuery.includes(keyword.toLowerCase())
    );
  });
}
