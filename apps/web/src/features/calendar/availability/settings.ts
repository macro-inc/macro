/**
 * Persisted copy-availability preferences. One module-level shared signal so
 * the calendar header and the email composer see the same values and react
 * to each other's changes immediately (`usePreference` would give each
 * surface its own signal that only shares the localStorage key).
 */

import { makePersisted } from '@solid-primitives/storage';
import { createSignal } from 'solid-js';
import { CALENDAR_PREFERENCES_KEY } from '../components/CalendarViewContext';
import type { CalendarTimeFormat } from '../types';
import { getDefaultCalendarTimeFormat } from '../utils/time-format';
import {
  type AvailabilitySettings,
  DEFAULT_AVAILABILITY_SETTINGS,
  sanitizeAvailabilitySettings,
} from './availability';

const [storedSettings, setStoredSettings] = makePersisted(
  createSignal<AvailabilitySettings>(DEFAULT_AVAILABILITY_SETTINGS),
  {
    name: 'macro:pref:calendar:availability',
    // Persisted storage is user-editable and may predate fields added later:
    // malformed JSON or invalid values must never throw or reach the time
    // formatters, so everything read back is sanitized to a valid shape.
    deserialize: (raw) => {
      try {
        return sanitizeAvailabilitySettings(JSON.parse(raw));
      } catch {
        return DEFAULT_AVAILABILITY_SETTINGS;
      }
    },
  }
);

/** Keeps the workday at least an hour long when one edge crosses the other. */
function shiftTime(time: string, deltaMinutes: number): string {
  const [hours = 0, minutes = 0] = time.split(':').map(Number);
  const total = Math.min(
    Math.max(hours * 60 + minutes + deltaMinutes, 0),
    23 * 60 + 30
  );
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/** Shared accessor + setters for the copy-availability settings menu. */
export function useAvailabilitySettings() {
  const settings = (): AvailabilitySettings =>
    sanitizeAvailabilitySettings(storedSettings());

  const setStartTime = (startTime: string) => {
    const current = settings();
    setStoredSettings({
      ...current,
      startTime,
      // 'HH:MM' strings order lexicographically, so >= is a time comparison.
      endTime:
        startTime >= current.endTime
          ? shiftTime(startTime, 60)
          : current.endTime,
    });
  };

  const setEndTime = (endTime: string) => {
    const current = settings();
    setStoredSettings({
      ...current,
      endTime,
      startTime:
        endTime <= current.startTime
          ? shiftTime(endTime, -60)
          : current.startTime,
    });
  };

  const setExcludeWeekends = (excludeWeekends: boolean) =>
    setStoredSettings({ ...settings(), excludeWeekends });

  return { settings, setStartTime, setEndTime, setExcludeWeekends };
}

/**
 * The calendar's persisted 12/24-hour preference, readable outside the
 * calendar block (the email composer has no CalendarViewContext). Read at
 * copy time, so a preference change applies to the next copy.
 */
export function getPersistedCalendarTimeFormat(): CalendarTimeFormat {
  try {
    const raw = localStorage.getItem(CALENDAR_PREFERENCES_KEY);
    if (raw) {
      const timeFormat = (
        JSON.parse(raw) as { timeFormat?: CalendarTimeFormat }
      ).timeFormat;
      if (timeFormat === '12-hour' || timeFormat === '24-hour') {
        return timeFormat;
      }
    }
  } catch {
    // Unreadable storage falls through to the locale default.
  }
  return getDefaultCalendarTimeFormat();
}
