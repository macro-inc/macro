import { toast } from '@core/component/Toast/Toast';
import { useUserId } from '@core/context/user';
import { fireAndForget } from '@core/util/fireAndForget';
import { useVisibleCalendarsQuery } from '@queries/calendar/calendars';
import {
  type CalendarColorChange,
  useSetCalendarColorMutation,
} from '@queries/calendar/colors';
import { ResultAsync } from 'neverthrow';
import { createEffect, on } from 'solid-js';
import { normalizeCalendarHex } from '../core/calendar-color';
import { useCalendarPreferences } from '../utils/preferences';

/**
 * Saves the person's own color for a calendar, or clears it with `undefined`
 * to show the account default or the provider's color again. It is kept for
 * their account, so it follows them to every device.
 */
export function useSetCalendarColor() {
  const userId = useUserId();
  const [, setPreferences] = useCalendarPreferences();
  const mutation = useSetCalendarColorMutation();

  return (calendarId: string, color: string | undefined) => {
    const user = userId();
    const normalized = color === undefined ? null : normalizeCalendarHex(color);
    if (!user || normalized === undefined) return;

    fireAndForget(
      (async () => {
        const saved = await ResultAsync.fromPromise(
          mutation.mutateAsync({ userId: user, calendarId, color: normalized }),
          (error) => error
        );
        if (saved.isErr()) {
          toast.failure('Could not save the calendar color');
          return;
        }
        // The account's choice replaces a color this browser still held.
        setPreferences('sourceColors', calendarId, undefined);
      })(),
      'calendar-color'
    );
  };
}

/**
 * Moves each calendar color this browser saved before colors were kept for
 * the account: once per calendar and page load, and only to a calendar the
 * account has no color for. The local color stays, and keeps showing, until
 * the server confirms it, so a failed upload is tried again on the next load.
 */
export function useUploadBrowserCalendarColors() {
  const userId = useUserId();
  const [preferences, setPreferences] = useCalendarPreferences();
  // Most browsers hold none, and those never read the list for this.
  const calendarsQuery = useVisibleCalendarsQuery(() => ({
    enabled: Object.values(preferences.sourceColors).some(
      (color) => color !== undefined
    ),
  }));
  const mutation = useSetCalendarColorMutation();
  const attempted = new Set<string>();

  const upload = async (change: CalendarColorChange) => {
    const saved = await ResultAsync.fromPromise(
      mutation.mutateAsync(change),
      (error) => error
    );
    if (saved.isOk()) {
      setPreferences('sourceColors', change.calendarId, undefined);
    }
  };

  createEffect(
    on(
      () =>
        [
          userId(),
          calendarsQuery.isSuccess ? calendarsQuery.data : undefined,
          { ...preferences.sourceColors },
        ] as const,
      ([user, calendars, local]) => {
        if (!user || !calendars) return;
        for (const [calendarId, color] of Object.entries(local)) {
          if (color === undefined || attempted.has(calendarId)) continue;
          // Another account signed in on this browser may own the calendar.
          const calendar = calendars.find(({ id }) => id === calendarId);
          if (!calendar) continue;
          attempted.add(calendarId);
          if (calendar.customColor) {
            setPreferences('sourceColors', calendarId, undefined);
            continue;
          }
          const hex = normalizeCalendarHex(color);
          if (!hex) continue;
          fireAndForget(
            upload({ userId: user, calendarId, color: hex }),
            'calendar-color-upload'
          );
        }
      }
    )
  );
}
