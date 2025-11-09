/**
 * Formats epoch date (unix timestamp seconds) to a human readable date.
 * @param epochDate - Unix timestamp in seconds. The date to format.
 * @param epochNow - Unix timestamp in seconds. An optional reference date.
 * @param timeZone - IANA timezone string (e.g., 'America/New_York', 'UTC'). Defaults to system timezone.
 * @returns Formatted date string. Like '4:53 PM' for same local day or, 'Yesterday at 8:10 AM' for
 *     single day offsets, 'Thursday' for a day within the week and '01/23/2025' for dates outside the week.
 */
export const formatDate = (
  epochDate: number,
  epochNow?: number,
  timeZone?: string
) => {
  // handle computation in different timezones
  const getDatePartsInTimezone = (date: Date, tz?: string) => {
    if (tz) {
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
      });
      const parts = formatter.formatToParts(date);
      const year = parseInt(
        parts.find((p) => p.type === 'year')?.value || '1970'
      );
      const month = Math.max(
        0,
        parseInt(parts.find((p) => p.type === 'month')?.value || '1') - 1
      );
      const day = Math.max(
        1,
        parseInt(parts.find((p) => p.type === 'day')?.value || '1')
      );
      return { year, month, day };
    } else {
      return {
        year: date.getFullYear(),
        month: date.getMonth(),
        day: date.getDate(),
      };
    }
  };

  const now = epochNow ? new Date(epochNow * 1000) : new Date();
  const inputDate = new Date(epochDate * 1000);

  // calculate a midnight aware day boundary
  const nowParts = getDatePartsInTimezone(now, timeZone);
  const inputParts = getDatePartsInTimezone(inputDate, timeZone);

  const today = new Date(nowParts.year, nowParts.month, nowParts.day);
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
  const inputDateStart = new Date(
    inputParts.year,
    inputParts.month,
    inputParts.day
  );

  const time = inputDate.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone,
  });

  if (inputDateStart.getTime() === today.getTime()) {
    return time;
  }

  if (inputDateStart.getTime() === yesterday.getTime()) {
    return `Yesterday at ${time}`;
  }

  const diffMs = now.getTime() - inputDate.getTime();
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (days < 7) {
    return inputDate.toLocaleDateString(undefined, {
      weekday: 'long',
      timeZone,
    });
  }

  return inputDate.toLocaleDateString(undefined, {
    month: '2-digit',
    day: '2-digit',
    year: '2-digit',
    timeZone,
  });
};

/**
 * Formats a date in the format "Fri, Jul 4, 2025 at 12:20 AM"
 * @param epochDate - Unix timestamp in seconds
 * @returns Formatted date string
 */
export const formatEmailDate = (epochDate: number) => {
  const inputDate = new Date(epochDate * 1000);

  const weekday = inputDate.toLocaleDateString('en-US', { weekday: 'short' });
  const month = inputDate.toLocaleDateString('en-US', { month: 'short' });
  const day = inputDate.getDate();
  const year = inputDate.getFullYear();
  const time = inputDate.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  return `${weekday}, ${month} ${day}, ${year} at ${time}`;
};

/**
 * Converts an ISO 8601 date string to Unix timestamp in seconds
 * @param isoString - ISO 8601 date string (e.g., "2025-08-18T18:07:54.000Z")
 * @returns Unix timestamp in seconds
 */
export const isoToUnixTimestamp = (isoString: string): number => {
  return Math.floor(new Date(isoString).getTime() / 1000);
};
