import {
  addDays,
  addYears,
  format,
  getYear,
  isValid,
  parse,
  setYear,
} from 'date-fns';
import { type Accessor, createMemo } from 'solid-js';
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

interface ParsedTime {
  hours: number; // 0-23
  minutes: number; // 0-59
}

/**
 * Parse time strings like "9am", "9 AM", "3:30pm", "14:00", "noon", "midnight"
 * Returns the parsed time and the remaining input with the time portion removed.
 */
function parseTime(input: string): { time: ParsedTime; rest: string } | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // "noon"
  if (/^noon$/i.test(trimmed)) {
    return { time: { hours: 12, minutes: 0 }, rest: '' };
  }
  // "midnight"
  if (/^midnight$/i.test(trimmed)) {
    return { time: { hours: 0, minutes: 0 }, rest: '' };
  }

  // Try matching time at end of string: "tomorrow 9am", "feb 17 3:30 PM"
  // Also matches standalone: "9am", "3:30pm", "14:00"
  const timeAtEnd = /^(.*?)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s*$/i;
  const time24AtEnd = /^(.*?)\s*(\d{1,2}):(\d{2})\s*$/;

  let match = trimmed.match(timeAtEnd);
  if (match) {
    let hours = parseInt(match[2]);
    const minutes = parseInt(match[3] || '0');
    const meridiem = match[4].toLowerCase();

    if (hours < 1 || hours > 12 || minutes > 59) return null;

    if (meridiem === 'pm' && hours !== 12) hours += 12;
    if (meridiem === 'am' && hours === 12) hours = 0;

    return { time: { hours, minutes }, rest: match[1].trim() };
  }

  // 24-hour format: "14:00", "tomorrow 14:00"
  match = trimmed.match(time24AtEnd);
  if (match) {
    const hours = parseInt(match[2]);
    const minutes = parseInt(match[3]);

    if (hours > 23 || minutes > 59) return null;

    return { time: { hours, minutes }, rest: match[1].trim() };
  }

  // Time at start: "9am tomorrow", "3:30 PM feb 17"
  const timeAtStart = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s+(.+)$/i;
  match = trimmed.match(timeAtStart);
  if (match) {
    let hours = parseInt(match[1]);
    const minutes = parseInt(match[2] || '0');
    const meridiem = match[3].toLowerCase();

    if (hours < 1 || hours > 12 || minutes > 59) return null;

    if (meridiem === 'pm' && hours !== 12) hours += 12;
    if (meridiem === 'am' && hours === 12) hours = 0;

    return { time: { hours, minutes }, rest: match[4].trim() };
  }

  return null;
}

/**
 * Format a parsed time for display, e.g. "9 AM", "3:30 PM"
 */
function formatParsedTime(time: ParsedTime): string {
  const h = time.hours % 12 || 12;
  const meridiem = time.hours >= 12 ? 'PM' : 'AM';
  if (time.minutes === 0) {
    return `${h} ${meridiem}`;
  }
  return `${h}:${time.minutes.toString().padStart(2, '0')} ${meridiem}`;
}

/**
 * Apply a parsed time to a date, returning a new Date with the time set.
 */
function applyTime(date: Date, time: ParsedTime): Date {
  const result = new Date(date);
  result.setHours(time.hours, time.minutes, 0, 0);
  return result;
}

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
  baseDate: Date = new Date(),
  showTime = true
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
    return showTime ? `Today, ${format(date, 'h:mm a')}` : 'Today';
  } else if (diffDays === 1) {
    return showTime ? `Tomorrow, ${format(date, 'h:mm a')}` : 'Tomorrow';
  } else if (diffDays === -1) {
    return showTime ? `Yesterday, ${format(date, 'h:mm a')}` : 'Yesterday';
  } else if (diffDays > 0 && diffDays <= 7) {
    return showTime
      ? format(date, "EEEE, MMM d 'at' h:mm a")
      : format(date, 'EEEE, MMM d');
  } else {
    const sameYear = date.getFullYear() === now.getFullYear();
    if (showTime) {
      return sameYear
        ? format(date, "MMM d 'at' h:mm a")
        : format(date, "MMM d, yyyy 'at' h:mm a");
    }
    return sameYear ? format(date, 'MMM d') : format(date, 'MMM d, yyyy');
  }
}

export function useDateSearch(params: {
  query: Accessor<string>;
  baseDate?: Date;
  defaultTime?: ParsedTime;
  showTimeInResults?: boolean;
  maxItems?: number;
}) {
  const baseDate = params.baseDate || new Date();

  const dateOptions = createMemo(() => {
    const query = params.query().trim();
    const options: DateOption[] = [];

    if (!query) {
      const presets = searchPresets('');
      return presets
        .map((preset): DateOption => {
          let date = preset.getDate(baseDate);
          if (params.defaultTime) {
            date = applyTime(date, params.defaultTime);
          }
          return {
            id: preset.id,
            displayText: preset.label,
            secondaryText: formatDateWithContext(
              date,
              baseDate,
              params.showTimeInResults ?? true
            ),
            date,
            type: 'preset',
            score: 0,
          };
        })
        .filter((option) => option.date > new Date())
        .slice(0, PRESET_COUNT);
    }

    // Extract time component if present (e.g., "9am", "tomorrow 3:30pm")
    const parsedTime = parseTime(query);
    const dateQuery = parsedTime ? parsedTime.rest : query;

    // 1. Try parsing as duration DSL (3d, 1w, etc.)
    // Only parse the date portion; if time was extracted and nothing remains, skip duration parsing
    const durationInput = parsedTime ? dateQuery : query;
    const parsedDuration = durationInput
      ? parseDurationString(durationInput)
      : null;
    if (parsedDuration) {
      let durationDate = parseDateFromDuration(durationInput, new Date());
      if (durationDate) {
        if (parsedTime) {
          durationDate = applyTime(durationDate, parsedTime.time);
        }
        options.push({
          id: `duration-${query}`,
          displayText: `${query} (${formatDuration(parsedDuration)} from now)`,
          secondaryText: formatDateWithContext(
            durationDate,
            baseDate,
            params.showTimeInResults ?? true
          ),
          date: durationDate,
          type: 'duration',
          score: 100,
        });
      }
    }

    // 2. Standalone time with no date part (e.g., "9am", "3:30pm") → today, or tomorrow if past
    if (parsedTime && !dateQuery) {
      const now = new Date();
      let todayWithTime = applyTime(now, parsedTime.time);
      if (todayWithTime <= now) {
        todayWithTime = addDays(todayWithTime, 1);
      }
      options.push({
        id: `time-${query}`,
        displayText: query,
        secondaryText: formatDateWithContext(
          todayWithTime,
          baseDate,
          params.showTimeInResults ?? true
        ),
        date: todayWithTime,
        type: 'natural',
        score: 98,
      });
    }

    // 3. Try parsing as natural date (feb 17, march 3, thursday, etc.)
    const naturalQuery = dateQuery || query;
    let naturalDate = parseNaturalDate(naturalQuery, baseDate);
    if (naturalDate) {
      const naturalTime = parsedTime?.time ?? params.defaultTime;
      if (naturalTime) {
        naturalDate = applyTime(naturalDate, naturalTime);
      }
      const displayText = parsedTime
        ? `${naturalQuery} at ${formatParsedTime(parsedTime.time)}`
        : query;
      options.push({
        id: `natural-${query}`,
        displayText,
        secondaryText: formatDateWithContext(
          naturalDate,
          baseDate,
          params.showTimeInResults ?? true
        ),
        date: naturalDate,
        type: 'natural',
        score: 95,
      });
    }

    // Search presets using both the full query and the date-only part (time stripped)
    const presetQuery = parsedTime && dateQuery ? dateQuery : query;
    const matchingPresets = searchPresets(presetQuery);
    const effectiveTime = parsedTime?.time ?? params.defaultTime;
    matchingPresets.forEach((preset) => {
      let date = preset.getDate(baseDate);
      if (effectiveTime) {
        date = applyTime(date, effectiveTime);
      }
      const option: DateOption = {
        id: `preset-${preset.id}`,
        displayText: parsedTime
          ? `${preset.label} at ${formatParsedTime(parsedTime.time)}`
          : preset.label,
        secondaryText: formatDateWithContext(
          date,
          baseDate,
          params.showTimeInResults ?? true
        ),
        date,
        type: 'preset',
        score: 0,
      };

      option.score = scoreMatch(option, presetQuery);

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
export { formatDateWithContext, parseNaturalDate, parseTime };
