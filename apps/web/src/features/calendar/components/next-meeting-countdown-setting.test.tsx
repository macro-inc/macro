import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import { afterEach, expect, it, vi } from 'vitest';
import { CALENDAR_PREFERENCES_KEY } from '../calendar-preferences';
import { NextMeetingCountdownSetting } from './next-meeting-countdown-setting';

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.resetModules();
});

it('previews the countdown pill and hides it when switched off', () => {
  const ui = render(() => <NextMeetingCountdownSetting />);
  const toggle = ui.getByRole('switch', { name: 'Next meeting countdown' });
  const preview = () =>
    ui.container.querySelector('[data-next-meeting-preview]');

  expect(toggle.getAttribute('aria-checked') ?? '').not.toBe('false');
  expect(preview()?.getAttribute('data-next-meeting-preview')).toBe('shown');
  expect(preview()?.textContent).toBe('23m');

  fireEvent.click(toggle);

  expect(preview()?.getAttribute('data-next-meeting-preview')).toBe('hidden');
  expect(preview()?.textContent).toBe('');
  expect(
    JSON.parse(localStorage.getItem(CALENDAR_PREFERENCES_KEY) ?? '{}')
      .showNextMeetingBadge
  ).toBe(false);
});
