/**
 * @vitest-environment jsdom
 */

import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CopyAvailabilityDialog } from './CopyAvailabilityDialog';

const mocks = vi.hoisted(() => ({
  getAvailabilityText: vi.fn(),
  writeClipboardData: vi.fn(),
  alert: vi.fn(),
  failure: vi.fn(),
}));

vi.mock('./use-availability-text', () => ({
  useAvailabilityText: () => mocks.getAvailabilityText,
}));
vi.mock('./settings', () => ({
  useAvailabilitySettings: () => ({
    settings: () => ({
      startTime: '09:00',
      endTime: '18:00',
      excludeWeekends: true,
    }),
    setStartTime: vi.fn(),
    setEndTime: vi.fn(),
    setExcludeWeekends: vi.fn(),
  }),
}));
vi.mock('@core/util/dataTransfer', () => ({
  writeClipboardData: mocks.writeClipboardData,
}));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { alert: mocks.alert, failure: mocks.failure },
}));

beforeEach(() => {
  vi.stubGlobal('scrollTo', vi.fn());
  mocks.getAvailabilityText.mockResolvedValue(
    'My availability:\nToday: 9 AM – 10 AM'
  );
  mocks.writeClipboardData.mockResolvedValue(true);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it('shows a successful copy inline with a check icon', async () => {
  render(() => <CopyAvailabilityDialog open onOpenChange={vi.fn()} />);

  fireEvent.click(
    screen.getByRole('button', { name: 'Copy availability for Today' })
  );

  const copied = await screen.findByRole('button', {
    name: 'Today availability copied',
  });
  expect(copied.getAttribute('data-variant')).toBe('success');
  expect(copied.className).toContain('bg-success-bg');
  expect(copied.textContent).toContain('Copied');
  expect(screen.getByRole('status').textContent).toBe('Availability copied');
  expect(mocks.writeClipboardData).toHaveBeenCalledWith({
    'text/plain': 'My availability:\nToday: 9 AM – 10 AM',
  });
});
