import {
  addDays,
  addHours,
  addMinutes,
  addMonths,
  addWeeks,
  endOfDay,
  endOfMonth,
  endOfWeek,
  endOfYear,
  startOfDay,
  startOfMonth,
  startOfWeek,
  startOfYear,
} from 'date-fns';

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
    id: 'now',
    label: 'Now',
    keywords: ['now'],
    getDate: (baseDate = new Date()) => addMinutes(baseDate, 10),
    category: 'quick',
  },
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
    label: 'Tomorrow',
    shortLabel: 'Tom',
    keywords: ['tomorrow', 'tmrw', 'tom'],
    getDate: (baseDate = new Date()) => addDays(startOfDay(baseDate), 1),
    category: 'quick',
  },
  {
    id: 'in-3-hours',
    label: 'In 3 hours',
    shortLabel: '3h',
    keywords: ['3 hours', '3h', 'three hours'],
    getDate: (baseDate = new Date()) => addHours(baseDate, 3),
    category: 'quick',
  },
  {
    id: 'in-2-days',
    label: 'In 2 days',
    shortLabel: '2d',
    keywords: ['2 days', '2d', 'two days'],
    getDate: (baseDate = new Date()) => addDays(baseDate, 2),
    category: 'quick',
  },

  // Week-based options
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

/**
 * Search presets by keyword
 */
export function searchPresets(query: string): DatePreset[] {
  const normalizedQuery = query.toLowerCase().trim();

  if (!normalizedQuery) {
    return DATE_PRESETS;
  }

  return DATE_PRESETS.filter((preset) => {
    // Check if label matches
    if (preset.label.toLowerCase().includes(normalizedQuery)) {
      return true;
    }

    // Check if short label matches
    if (preset.shortLabel?.toLowerCase().includes(normalizedQuery)) {
      return true;
    }

    // Check if any keyword matches
    return preset.keywords.some((keyword) =>
      keyword.toLowerCase().includes(normalizedQuery)
    );
  });
}

/**
 * Get presets grouped by category
 */
export function getPresetsGrouped(): Record<string, DatePreset[]> {
  const grouped: Record<string, DatePreset[]> = {
    quick: [],
    week: [],
    month: [],
    year: [],
    other: [],
  };

  DATE_PRESETS.forEach((preset) => {
    const category = preset.category || 'other';
    grouped[category].push(preset);
  });

  // Remove empty groups
  Object.keys(grouped).forEach((key) => {
    if (grouped[key].length === 0) {
      delete grouped[key];
    }
  });

  return grouped;
}
