/**
 * Parse natural language date inputs like "today", "tomorrow", "next week", etc.
 */

import { differenceInCalendarDays } from 'date-fns';

export type ParsedDate = {
  date: Date;
  displayFormat: string;
  confidence: number; // 0-1, how confident we are in the parse
};

const WEEKDAYS = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
];

const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

const MONTH_ABBR = [
  'jan',
  'feb',
  'mar',
  'apr',
  'may',
  'jun',
  'jul',
  'aug',
  'sep',
  'oct',
  'nov',
  'dec',
];

function dateOffsetFrom(today: Date, days: number): Date {
  const date = new Date(today);
  date.setDate(date.getDate() + days);
  return date;
}

function parseToday(normalized: string, today: Date): ParsedDate | null {
  if (normalized !== 'today' && normalized !== 'tod') return null;
  return {
    date: new Date(today),
    displayFormat: 'Today',
    confidence: 1,
  };
}

function parseTomorrow(normalized: string, today: Date): ParsedDate | null {
  if (
    normalized !== 'tomorrow' &&
    normalized !== 'tom' &&
    normalized !== 'tmrw'
  ) {
    return null;
  }
  return {
    date: dateOffsetFrom(today, 1),
    displayFormat: 'Tomorrow',
    confidence: 1,
  };
}

function parseYesterday(normalized: string, today: Date): ParsedDate | null {
  if (normalized !== 'yesterday' && normalized !== 'yest') return null;
  return {
    date: dateOffsetFrom(today, -1),
    displayFormat: 'Yesterday',
    confidence: 1,
  };
}

function parseNextWeek(normalized: string, today: Date): ParsedDate | null {
  if (normalized !== 'next week' && normalized !== 'nw') return null;
  const nextWeek = dateOffsetFrom(today, 7);
  return {
    date: nextWeek,
    displayFormat: formatDate(nextWeek),
    confidence: 1,
  };
}

function parseThisWeek(normalized: string, today: Date): ParsedDate | null {
  if (normalized !== 'this week' && normalized !== 'tw') return null;
  // Get next Monday
  const daysUntilMonday = (8 - today.getDay()) % 7 || 7;
  const thisWeek = dateOffsetFrom(today, daysUntilMonday);
  return {
    date: thisWeek,
    displayFormat: formatDate(thisWeek),
    confidence: 0.9,
  };
}

function parseWeekdayName(normalized: string, today: Date): ParsedDate | null {
  for (let i = 0; i < WEEKDAYS.length; i++) {
    if (!normalized.startsWith(WEEKDAYS[i].slice(0, 3))) continue;
    const targetDay = i;
    const currentDay = today.getDay();
    let daysToAdd = targetDay - currentDay;

    // If the day has passed this week, get next week's
    if (daysToAdd <= 0) {
      daysToAdd += 7;
    }

    const targetDate = dateOffsetFrom(today, daysToAdd);
    return {
      date: targetDate,
      displayFormat: formatDate(targetDate),
      confidence: normalized === WEEKDAYS[i] ? 1 : 0.8,
    };
  }
  return null;
}

function parseMonthDayPart(parts: string[]): number {
  if (parts.length <= 1) return 1;
  const dayPart = parts[1].replace(/[^\d]/g, '');
  if (!dayPart) return 1;
  const day = parseInt(dayPart, 10);
  if (isNaN(day) || day < 1 || day > 31) return 1;
  return day;
}

function parseMonthYearPart(parts: string[], fallbackYear: number): number {
  if (parts.length <= 2) return fallbackYear;
  const yearPart = parts[2].replace(/[^\d]/g, '');
  if (!yearPart) return fallbackYear;
  const parsedYear = parseInt(yearPart, 10);
  if (isNaN(parsedYear)) return fallbackYear;
  // Handle 2-digit years
  if (parsedYear >= 0 && parsedYear <= 99) {
    // Assume 00-50 means 2000-2050, 51-99 means 1951-1999
    return parsedYear <= 50 ? 2000 + parsedYear : 1900 + parsedYear;
  }
  if (parsedYear >= 1900 && parsedYear <= 2100) {
    return parsedYear;
  }
  return fallbackYear;
}

function parseMonthName(normalized: string, today: Date): ParsedDate | null {
  for (let i = 0; i < MONTHS.length; i++) {
    if (
      !normalized.startsWith(MONTHS[i]) &&
      !normalized.startsWith(MONTH_ABBR[i])
    ) {
      continue;
    }
    const parts = normalized.split(/\s+/);
    const day = parseMonthDayPart(parts);
    const year = parseMonthYearPart(parts, today.getFullYear());
    const targetDate = new Date(year, i, day);

    // Only apply "next year" logic if no year was explicitly provided
    if (parts.length <= 2 && targetDate < today) {
      targetDate.setFullYear(targetDate.getFullYear() + 1);
    }

    return {
      date: targetDate,
      displayFormat: formatDate(targetDate),
      confidence: parts.length > 2 ? 0.95 : parts.length > 1 ? 0.9 : 0.7,
    };
  }
  return null;
}

function parseInDays(normalized: string, today: Date): ParsedDate | null {
  const inDaysMatch = normalized.match(/^in\s+(\d+)\s+days?$/);
  if (!inDaysMatch) return null;
  const days = parseInt(inDaysMatch[1], 10);
  if (isNaN(days) || days <= 0 || days >= 365) return null;
  const targetDate = dateOffsetFrom(today, days);
  return {
    date: targetDate,
    displayFormat: formatDate(targetDate),
    confidence: 1,
  };
}

function parseNextMonth(normalized: string, today: Date): ParsedDate | null {
  if (normalized !== 'next month' && normalized !== 'nm') return null;
  const nextMonth = new Date(today);
  nextMonth.setMonth(nextMonth.getMonth() + 1);
  nextMonth.setDate(1);
  return {
    date: nextMonth,
    displayFormat: formatDate(nextMonth),
    confidence: 0.9,
  };
}

function parseNumericDate(normalized: string, today: Date): ParsedDate | null {
  const dateMatch = normalized.match(/^(\d{1,2})[\/\-](\d{1,2})$/);
  if (!dateMatch) return null;
  const [, first, second] = dateMatch;
  const month = parseInt(first, 10) - 1; // Assume MM/DD for now
  const day = parseInt(second, 10);

  if (month < 0 || month >= 12 || day < 1 || day > 31) return null;
  const targetDate = new Date(today.getFullYear(), month, day);

  // If the date has passed this year, use next year
  if (targetDate < today) {
    targetDate.setFullYear(targetDate.getFullYear() + 1);
  }

  return {
    date: targetDate,
    displayFormat: formatDate(targetDate),
    confidence: 0.8,
  };
}

function parseNumericDateWithYear(normalized: string): ParsedDate | null {
  const dateWithYearMatch = normalized.match(
    /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/
  );
  if (!dateWithYearMatch) return null;
  const [, first, second, yearStr] = dateWithYearMatch;
  const month = parseInt(first, 10) - 1; // Assume MM/DD/YYYY for now
  const day = parseInt(second, 10);
  let year = parseInt(yearStr, 10);

  // Handle 2-digit years
  if (year >= 0 && year <= 99) {
    year = year <= 50 ? 2000 + year : 1900 + year;
  }

  if (
    month < 0 ||
    month >= 12 ||
    day < 1 ||
    day > 31 ||
    year < 1900 ||
    year > 2100
  ) {
    return null;
  }

  const targetDate = new Date(year, month, day);
  return {
    date: targetDate,
    displayFormat: formatDate(targetDate),
    confidence: 0.9,
  };
}

function parseDateString(input: string): ParsedDate | null {
  const normalized = input.toLowerCase().trim();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return (
    parseToday(normalized, today) ??
    parseTomorrow(normalized, today) ??
    parseYesterday(normalized, today) ??
    parseNextWeek(normalized, today) ??
    parseThisWeek(normalized, today) ??
    parseWeekdayName(normalized, today) ??
    parseMonthName(normalized, today) ??
    parseInDays(normalized, today) ??
    parseNextMonth(normalized, today) ??
    parseNumericDate(normalized, today) ??
    parseNumericDateWithYear(normalized)
  );
}

export function formatDate(date: Date): string {
  // Check if it's today or tomorrow for special formatting
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const dateOnly = new Date(date);
  dateOnly.setHours(0, 0, 0, 0);

  if (dateOnly.getTime() === today.getTime()) {
    return 'Today';
  } else if (dateOnly.getTime() === tomorrow.getTime()) {
    return 'Tomorrow';
  }

  // Calculate if we should show the year
  const oneMonthFromNow = new Date(today);
  oneMonthFromNow.setMonth(oneMonthFromNow.getMonth() + 1);

  const isPastDate = dateOnly.getTime() < today.getTime();
  const isMoreThanOneMonthInFuture =
    dateOnly.getTime() > oneMonthFromNow.getTime();
  const shouldShowYear = isPastDate || isMoreThanOneMonthInFuture;

  const options: Intl.DateTimeFormatOptions = {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  };

  // Include year if date is in the past or more than one month in the future
  if (shouldShowYear) {
    options.year = 'numeric';
  }

  return date.toLocaleDateString('en-US', options);
}

/**
 * Day-relative label for dates near now — "Today", "Yesterday", "2 days ago",
 * "Tomorrow", "In 2 days" — falling back to `formatDate` beyond that window.
 * (Moved from the DateMention decorator so lists can share it.)
 */
export function formatRelativeDay(date: Date): string {
  const diff = differenceInCalendarDays(date, new Date());
  switch (diff) {
    case -2:
      return '2 days ago';
    case -1:
      return 'Yesterday';
    case 0:
      return 'Today';
    case 1:
      return 'Tomorrow';
    case 2:
      return 'In 2 days';
    default:
      return formatDate(date);
  }
}

function _getDateSuggestions(input: string): ParsedDate[] {
  const suggestions: ParsedDate[] = [];
  const normalized = input.toLowerCase().trim();

  // Always suggest today and tomorrow if they match
  if ('today'.startsWith(normalized) && normalized.length > 0) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    suggestions.push({
      date: today,
      displayFormat: 'Today',
      confidence: 1,
    });
  }

  if ('tomorrow'.startsWith(normalized) && normalized.length > 0) {
    const tomorrow = new Date();
    tomorrow.setHours(0, 0, 0, 0);
    tomorrow.setDate(tomorrow.getDate() + 1);
    suggestions.push({
      date: tomorrow,
      displayFormat: 'Tomorrow',
      confidence: 1,
    });
  }

  // Weekday suggestions
  const today = new Date();
  for (let i = 0; i < WEEKDAYS.length; i++) {
    if (WEEKDAYS[i].startsWith(normalized) && normalized.length > 1) {
      const targetDay = i;
      const currentDay = today.getDay();
      let daysToAdd = targetDay - currentDay;

      if (daysToAdd <= 0) {
        daysToAdd += 7;
      }

      const targetDate = new Date(today);
      targetDate.setHours(0, 0, 0, 0);
      targetDate.setDate(targetDate.getDate() + daysToAdd);

      suggestions.push({
        date: targetDate,
        displayFormat: formatDate(targetDate),
        confidence: 0.8,
      });
    }
  }

  // Month suggestions
  for (let i = 0; i < MONTHS.length; i++) {
    if (MONTHS[i].startsWith(normalized) && normalized.length > 1) {
      const targetDate = new Date(today.getFullYear(), i, 1);
      targetDate.setHours(0, 0, 0, 0);

      // If the month has passed this year, use next year
      if (targetDate < today) {
        targetDate.setFullYear(targetDate.getFullYear() + 1);
      }

      suggestions.push({
        date: targetDate,
        displayFormat: formatDate(targetDate),
        confidence: 0.7,
      });
    }
  }

  // Try to parse the full input
  const parsed = parseDateString(normalized);
  if (
    parsed &&
    !suggestions.some((s) => s.date.getTime() === parsed.date.getTime())
  ) {
    suggestions.push(parsed);
  }

  // Sort by confidence and limit
  return suggestions.sort((a, b) => b.confidence - a.confidence).slice(0, 5);
}
