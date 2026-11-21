import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, expect, it, onTestFinished } from 'vitest';
import { useCalendarPreferences } from '../../calendar/utils/preferences';
import { newSchedule } from '../core/types';
import { ScheduleFields } from './schedule-fields-view';

afterEach(cleanup);

function showSchedule() {
  render(() => (
    <ScheduleFields schedule={newSchedule('UTC')} onChange={() => {}} />
  ));
}

it('starts on the calendar’s 24-hour clock and switches this editor only', async () => {
  const [preferences, setPreferences] = useCalendarPreferences();
  setPreferences('timeFormat', '24-hour');
  onTestFinished(() => setPreferences('timeFormat', '12-hour'));
  showSchedule();
  expect(
    screen.getByRole<HTMLInputElement>('radio', { name: '24h' }).checked
  ).toBe(true);
  expect(screen.getAllByText(/09:00–17:00/).length).toBeGreaterThan(0);

  fireEvent.click(screen.getByRole('radio', { name: '12h' }));
  expect(
    (await screen.findAllByText(/9:00 AM–5:00 PM/)).length
  ).toBeGreaterThan(0);
  expect(preferences.timeFormat).toBe('24-hour');
});
