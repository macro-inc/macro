import { createRoot } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CALENDAR_PREFERENCES_KEY } from '../calendar-preferences';

afterEach(() => {
  localStorage.clear();
  vi.resetModules();
});

describe('calendar preferences', () => {
  it('keeps a saved team out-of-office hide across reloads', async () => {
    localStorage.setItem(
      CALENDAR_PREFERENCES_KEY,
      JSON.stringify({ hiddenSourceIds: ['team-ooo', 'holidays'] })
    );
    const { useCalendarPreferences } = await import('./preferences');

    const hidden = createRoot((dispose) => {
      const [preferences] = useCalendarPreferences();
      const ids = [...preferences.hiddenSourceIds];
      dispose();
      return ids;
    });

    expect(hidden).toEqual(['team-ooo', 'holidays']);
  });

  it('shows the next meeting badge for saved preferences without the setting', async () => {
    localStorage.setItem(
      CALENDAR_PREFERENCES_KEY,
      JSON.stringify({ hiddenSourceIds: [] })
    );
    const { useCalendarPreferences } = await import('./preferences');

    const show = createRoot((dispose) => {
      const [preferences] = useCalendarPreferences();
      const value = preferences.showNextMeetingBadge;
      dispose();
      return value;
    });

    expect(show).toBe(true);
  });

  it('keeps the next meeting badge off across reloads', async () => {
    localStorage.setItem(
      CALENDAR_PREFERENCES_KEY,
      JSON.stringify({ showNextMeetingBadge: false })
    );
    const { useCalendarPreferences } = await import('./preferences');

    const show = createRoot((dispose) => {
      const [preferences] = useCalendarPreferences();
      const value = preferences.showNextMeetingBadge;
      dispose();
      return value;
    });

    expect(show).toBe(false);
  });
});
