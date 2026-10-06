export interface ParsedTime {
  hours: number; // 0-23
  minutes: number; // 0-59
}

/**
 * Parse time strings like "9am", "9 AM", "3:30pm", "14:00", "noon", "midnight"
 * Returns the parsed time and the remaining input with the time portion removed.
 */
export function parseTime(
  input: string
): { time: ParsedTime; rest: string } | null {
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
