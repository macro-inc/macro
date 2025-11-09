/**
 * Parse natural language date inputs like "today", "tomorrow", "next week", etc.
 */

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

export function parseDateString(input: string): ParsedDate | null {
  const normalized = input.toLowerCase().trim();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Today
  if (normalized === 'today' || normalized === 'tod') {
    return {
      date: new Date(today),
      displayFormat: 'Today',
      confidence: 1,
    };
  }

  // Tomorrow
  if (
    normalized === 'tomorrow' ||
    normalized === 'tom' ||
    normalized === 'tmrw'
  ) {
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    return {
      date: tomorrow,
      displayFormat: 'Tomorrow',
      confidence: 1,
    };
  }

  // Yesterday
  if (normalized === 'yesterday' || normalized === 'yest') {
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    return {
      date: yesterday,
      displayFormat: 'Yesterday',
      confidence: 1,
    };
  }

  // Next/This week
  if (normalized === 'next week' || normalized === 'nw') {
    const nextWeek = new Date(today);
    nextWeek.setDate(nextWeek.getDate() + 7);
    return {
      date: nextWeek,
      displayFormat: formatDate(nextWeek),
      confidence: 1,
    };
  }

  if (normalized === 'this week' || normalized === 'tw') {
    // Get next Monday
    const daysUntilMonday = (8 - today.getDay()) % 7 || 7;
    const thisWeek = new Date(today);
    thisWeek.setDate(thisWeek.getDate() + daysUntilMonday);
    return {
      date: thisWeek,
      displayFormat: formatDate(thisWeek),
      confidence: 0.9,
    };
  }

  // Weekday names
  for (let i = 0; i < WEEKDAYS.length; i++) {
    if (normalized.startsWith(WEEKDAYS[i].slice(0, 3))) {
      const targetDay = i;
      const currentDay = today.getDay();
      let daysToAdd = targetDay - currentDay;

      // If the day has passed this week, get next week's
      if (daysToAdd <= 0) {
        daysToAdd += 7;
      }

      const targetDate = new Date(today);
      targetDate.setDate(targetDate.getDate() + daysToAdd);

      return {
        date: targetDate,
        displayFormat: formatDate(targetDate),
        confidence: normalized === WEEKDAYS[i] ? 1 : 0.8,
      };
    }
  }

  // Month names (with optional day and year)
  for (let i = 0; i < MONTHS.length; i++) {
    if (
      normalized.startsWith(MONTHS[i]) ||
      normalized.startsWith(MONTH_ABBR[i])
    ) {
      // Extract day and year if present
      const parts = normalized.split(/\s+/);
      let day = 1;
      let year = today.getFullYear();

      if (parts.length > 1) {
        const dayPart = parts[1].replace(/[^\d]/g, '');
        if (dayPart) {
          day = parseInt(dayPart, 10);
          if (isNaN(day) || day < 1 || day > 31) {
            day = 1;
          }
        }
      }

      // Check for year in third part
      if (parts.length > 2) {
        const yearPart = parts[2].replace(/[^\d]/g, '');
        if (yearPart) {
          const parsedYear = parseInt(yearPart, 10);
          if (!isNaN(parsedYear)) {
            // Handle 2-digit years
            if (parsedYear >= 0 && parsedYear <= 99) {
              // Assume 00-50 means 2000-2050, 51-99 means 1951-1999
              year = parsedYear <= 50 ? 2000 + parsedYear : 1900 + parsedYear;
            } else if (parsedYear >= 1900 && parsedYear <= 2100) {
              year = parsedYear;
            }
          }
        }
      }

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
  }

  // Relative days (in X days)
  const inDaysMatch = normalized.match(/^in\s+(\d+)\s+days?$/);
  if (inDaysMatch) {
    const days = parseInt(inDaysMatch[1], 10);
    if (!isNaN(days) && days > 0 && days < 365) {
      const targetDate = new Date(today);
      targetDate.setDate(targetDate.getDate() + days);
      return {
        date: targetDate,
        displayFormat: formatDate(targetDate),
        confidence: 1,
      };
    }
  }

  // Next month
  if (normalized === 'next month' || normalized === 'nm') {
    const nextMonth = new Date(today);
    nextMonth.setMonth(nextMonth.getMonth() + 1);
    nextMonth.setDate(1);
    return {
      date: nextMonth,
      displayFormat: formatDate(nextMonth),
      confidence: 0.9,
    };
  }

  // Date formats (MM/DD, DD/MM depending on locale)
  const dateMatch = normalized.match(/^(\d{1,2})[\/\-](\d{1,2})$/);
  if (dateMatch) {
    const [, first, second] = dateMatch;
    const month = parseInt(first, 10) - 1; // Assume MM/DD for now
    const day = parseInt(second, 10);

    if (month >= 0 && month < 12 && day >= 1 && day <= 31) {
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
  }

  // Date formats with year (MM/DD/YYYY or DD/MM/YYYY)
  const dateWithYearMatch = normalized.match(
    /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/
  );
  if (dateWithYearMatch) {
    const [, first, second, yearStr] = dateWithYearMatch;
    const month = parseInt(first, 10) - 1; // Assume MM/DD/YYYY for now
    const day = parseInt(second, 10);
    let year = parseInt(yearStr, 10);

    // Handle 2-digit years
    if (year >= 0 && year <= 99) {
      year = year <= 50 ? 2000 + year : 1900 + year;
    }

    if (
      month >= 0 &&
      month < 12 &&
      day >= 1 &&
      day <= 31 &&
      year >= 1900 &&
      year <= 2100
    ) {
      const targetDate = new Date(year, month, day);

      return {
        date: targetDate,
        displayFormat: formatDate(targetDate),
        confidence: 0.9,
      };
    }
  }

  return null;
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

export function getDateSuggestions(input: string): ParsedDate[] {
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
