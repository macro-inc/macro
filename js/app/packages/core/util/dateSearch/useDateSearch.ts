import { createMemo, type Accessor } from 'solid-js';
import { format, parse, isValid, setYear, getYear, addYears } from 'date-fns';
import {
  formatDuration,
  parseDateFromDuration,
  parseDurationString,
} from './dateParser';
import { searchPresets } from './presets';

// Max number of presets to include
const PRESET_COUNT = 5;

const DEFAULT_MAX_ITEMS = 10;

export interface DateOption {
  id: string;
  displayText: string;
  secondaryText?: string;
  date: Date;
  type: 'duration' | 'preset' | 'natural' | 'absolute';
  score?: number;
}

const possibleDateFormats = [
  'MMM d', // "Jan 15"
  'MMMM d', // "January 15"
  'MMM d yyyy', // "Jan 15 2024"
  'MMMM d yyyy', // "January 15 2024"
  'M/d', // "1/15"
  'M/d/yyyy', // "1/15/2024"
  'MM/dd', // "01/15"
  'MM/dd/yyyy', // "01/15/2024"
  'd MMM', // "15 Jan"
  'd MMMM', // "15 January"
  'd MMM yyyy', // "15 Jan 2024"
  'd MMMM yyyy', // "15 January 2024"
  'yyyy-MM-dd', // "2024-01-15"
  'dd-MM-yyyy', // "15-01-2024"
];

/**
 * Parse natural date strings like "feb 17", "march 3", "jan 1 2025", etc.
 */
function parseNaturalDate(
  input: string,
  baseDate: Date = new Date()
): Date | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  for (const formatStr of possibleDateFormats) {
    try {
      const parsed = parse(trimmed, formatStr, baseDate);
      if (isValid(parsed)) {
        const hasYear = /\d{4}/.test(trimmed);
        if (!hasYear) {
          const currentYear = getYear(baseDate);
          let adjustedDate = setYear(parsed, currentYear);

          const sixMonthsAgo = new Date(baseDate);
          sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

          const adjustedDateOnly = new Date(adjustedDate);
          adjustedDateOnly.setHours(0, 0, 0, 0);
          const sixMonthsAgoDateOnly = new Date(sixMonthsAgo);
          sixMonthsAgoDateOnly.setHours(0, 0, 0, 0);

          if (adjustedDateOnly < sixMonthsAgoDateOnly) {
            adjustedDate = addYears(adjustedDate, 1);
          }

          return adjustedDate;
        }

        return parsed;
      }
    } catch {}
  }

  const lowerInput = trimmed.toLowerCase();
  const now = new Date(baseDate);

  const daysOfWeek = [
    'sunday',
    'monday',
    'tuesday',
    'wednesday',
    'thursday',
    'friday',
    'saturday',
  ];

  const dayIndex = daysOfWeek.findIndex(
    (day) => lowerInput === day || lowerInput === day.slice(0, 3)
  );

  if (dayIndex !== -1) {
    const currentDay = now.getDay();
    let daysToAdd = dayIndex - currentDay;

    if (daysToAdd <= 0) {
      daysToAdd += 7;
    }

    const result = new Date(now);
    result.setDate(result.getDate() + daysToAdd);
    return result;
  }

  return null;
}

/**
 * Score how well an option matches the query
 */
function scoreMatch(option: DateOption, query: string): number {
  const lowerQuery = query.toLowerCase();
  const lowerDisplay = option.displayText.toLowerCase();

  if (lowerDisplay === lowerQuery) return 100;
  if (lowerDisplay.startsWith(lowerQuery)) return 90;
  if (lowerDisplay.includes(lowerQuery)) return 70;
  if (option.secondaryText) {
    const lowerSecondary = option.secondaryText.toLowerCase();
    if (lowerSecondary.includes(lowerQuery)) return 50;
  }

  return 0;
}

/**
 * Format a date for display with relative context
 */
function formatDateWithContext(
  date: Date,
  baseDate: Date = new Date()
): string {
  const now = new Date(baseDate);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dateOnly = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate()
  );

  const diffDays = Math.floor(
    (dateOnly.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
  );

  if (diffDays === 0) {
    return `Today, ${format(date, 'h:mm a')}`;
  } else if (diffDays === 1) {
    return `Tomorrow, ${format(date, 'h:mm a')}`;
  } else if (diffDays === -1) {
    return `Yesterday, ${format(date, 'h:mm a')}`;
  } else if (diffDays > 0 && diffDays <= 7) {
    return format(date, "EEEE, MMM d 'at' h:mm a");
  } else {
    const sameYear = date.getFullYear() === now.getFullYear();
    return sameYear
      ? format(date, "MMM d 'at' h:mm a")
      : format(date, "MMM d, yyyy 'at' h:mm a");
  }
}

export function useDateSearch(params: {
  query: Accessor<string>;
  baseDate?: Date;
  maxItems?: number;
}) {
  const baseDate = params.baseDate || new Date();

  const dateOptions = createMemo(() => {
    const query = params.query().trim();
    const options: DateOption[] = [];

    if (!query) {
      const presets = searchPresets('');
      return presets.slice(0, PRESET_COUNT).map(
        (preset): DateOption => ({
          id: preset.id,
          displayText: preset.label,
          secondaryText: format(preset.getDate(baseDate), 'MMM d, yyyy'),
          date: preset.getDate(baseDate),
          type: 'preset',
          score: 0,
        })
      );
    }

    // 1. Try parsing as duration DSL (3d, 1w, etc.)
    const parsedDuration = parseDurationString(query);
    if (parsedDuration) {
      const durationDate = parseDateFromDuration(query, baseDate);
      if (durationDate) {
        options.push({
          id: `duration-${query}`,
          displayText: `${query} (${formatDuration(parsedDuration)} from now)`,
          secondaryText: formatDateWithContext(durationDate, baseDate),
          date: durationDate,
          type: 'duration',
          score: 100,
        });
      }
    }

    // 2. Try parsing as natural date (feb 17, march 3, etc.)
    const naturalDate = parseNaturalDate(query, baseDate);
    if (naturalDate) {
      options.push({
        id: `natural-${query}`,
        displayText: query,
        secondaryText: formatDateWithContext(naturalDate, baseDate),
        date: naturalDate,
        type: 'natural',
        score: 95,
      });
    }

    const matchingPresets = searchPresets(query);
    matchingPresets.forEach((preset) => {
      const date = preset.getDate(baseDate);
      const option: DateOption = {
        id: `preset-${preset.id}`,
        displayText: preset.label,
        secondaryText: formatDateWithContext(date, baseDate),
        date,
        type: 'preset',
        score: 0,
      };

      option.score = scoreMatch(option, query);

      if (option.score > 0) {
        options.push(option);
      }
    });

    options.sort((a, b) => {
      const scoreDiff = (b.score || 0) - (a.score || 0);
      if (scoreDiff !== 0) return scoreDiff;
      return a.date.getTime() - b.date.getTime();
    });

    return options.slice(0, params.maxItems ?? DEFAULT_MAX_ITEMS);
  });

  return dateOptions;
}

// Export helper functions for testing
export { parseNaturalDate, formatDateWithContext };
