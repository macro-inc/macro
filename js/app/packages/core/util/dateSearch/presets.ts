import { addDays, addWeeks, endOfDay, endOfWeek } from 'date-fns';

export interface DatePreset {
  id: string;
  label: string;
  shortLabel?: string;
  keywords: string[];
  getDate: (baseDate?: Date) => Date;
  category?: 'quick' | 'week' | 'month' | 'year';
}

export const DATE_PRESETS: DatePreset[] = [
  {
    id: 'today',
    label: 'Today (end of day)',
    shortLabel: 'Today',
    keywords: ['today', 'end', 'end of day', 'eod'],
    getDate: (baseDate = new Date()) => endOfDay(baseDate),
    category: 'quick',
  },
  {
    id: 'tomorrow',
    label: 'Tomorrow (end of day)',
    shortLabel: 'Tom',
    keywords: ['tomorrow', 'tmrw', 'tom'],
    getDate: (baseDate = new Date()) => addDays(endOfDay(baseDate), 1),
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
    keywords: ['end of week', 'eow', 'weekend', 'friday'],
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
];

export function searchPresets(query: string): DatePreset[] {
  const normalizedQuery = query.toLowerCase().trim();

  if (!normalizedQuery) {
    return DATE_PRESETS;
  }

  return DATE_PRESETS.filter((preset) => {
    if (preset.label.toLowerCase().includes(normalizedQuery)) {
      return true;
    }

    if (preset.shortLabel?.toLowerCase().includes(normalizedQuery)) {
      return true;
    }

    return preset.keywords.some((keyword) =>
      keyword.toLowerCase().includes(normalizedQuery)
    );
  });
}
