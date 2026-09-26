/**
 * @vitest-environment jsdom
 */

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AvailabilityRangeKey } from './availability';
import { CopyAvailabilityDialog } from './CopyAvailabilityDialog';

const mocks = vi.hoisted(() => ({
  days: vi.fn(),
  refreshRange: vi.fn(),
  isError: vi.fn(),
  retry: vi.fn(),
  writeClipboardData: vi.fn(),
  failure: vi.fn(),
  alert: vi.fn(),
}));

vi.mock('./use-availability-ranges', () => ({
  useAvailabilityRanges: () => ({
    days: mocks.days,
    refreshRange: mocks.refreshRange,
    isError: mocks.isError,
    retry: mocks.retry,
  }),
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
  getPersistedCalendarTimeFormat: () => '12-hour',
}));
vi.mock('@core/util/dataTransfer', () => ({
  writeClipboardData: mocks.writeClipboardData,
}));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { alert: mocks.alert, failure: mocks.failure },
}));

const availableDay = {
  date: new Date(2026, 7, 24),
  slots: [
    {
      start: new Date(2026, 7, 24, 10),
      end: new Date(2026, 7, 24, 11),
    },
  ],
};

beforeEach(() => {
  vi.stubGlobal('scrollTo', vi.fn());
  mocks.days.mockReturnValue({
    today: [availableDay],
    thisWeek: [availableDay],
    next7Days: [availableDay],
    next14Days: [availableDay],
  } satisfies Record<AvailabilityRangeKey, (typeof availableDay)[]>);
  mocks.isError.mockReturnValue(false);
  mocks.writeClipboardData.mockResolvedValue(true);
  mocks.refreshRange.mockResolvedValue({
    days: [availableDay],
    now: new Date(2026, 7, 24, 10),
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it('keeps the button neutral after copying and colors only the check', async () => {
  render(() => <CopyAvailabilityDialog open onOpenChange={vi.fn()} />);

  fireEvent.click(
    screen.getByRole('button', { name: 'Copy availability for Today' })
  );

  const copied = await screen.findByRole('button', {
    name: 'Today availability copied',
  });
  expect(copied.getAttribute('data-variant')).toBe('outline');
  expect(copied.className).not.toContain('bg-success');
  expect(copied.textContent).toContain('Copied');
  expect(copied.querySelector('svg.text-success')).toBeTruthy();
  expect(screen.getByRole('status').textContent).toBe('Availability copied');
  expect(mocks.writeClipboardData).toHaveBeenCalledWith({
    'text/plain': expect.stringContaining('Mon, Aug 24: 10:00 AM – 11:00 AM'),
  });
  expect(mocks.refreshRange).toHaveBeenCalledWith('today');
});

it('crossfades a left spinner into the copied state without changing button width', async () => {
  let finishRefresh!: (result: {
    days: (typeof availableDay)[];
    now: Date;
  }) => void;
  mocks.refreshRange.mockImplementation(
    () =>
      new Promise((resolve) => {
        finishRefresh = resolve;
      })
  );
  render(() => <CopyAvailabilityDialog open onOpenChange={vi.fn()} />);

  const initial = screen.getByRole('button', {
    name: 'Copy availability for Today',
  });
  const idleLayer = initial.querySelector('span[aria-hidden]')?.children[0];
  fireEvent.click(initial);

  const copying = screen.getByRole('button', {
    name: 'Copying availability for Today',
  });
  const layers = copying.querySelector('span[aria-hidden]')?.children;
  expect(copying.getAttribute('aria-busy')).toBe('true');
  expect(copying).toBe(initial);
  expect(copying.querySelector('span[aria-hidden]')?.className).toContain(
    'grid'
  );
  expect(idleLayer?.className).toContain('opacity-0');
  expect(layers?.[1].className).toContain('opacity-100');
  expect(layers?.[1].firstElementChild?.getAttribute('class')).toContain(
    'animate-spin'
  );
  expect(screen.getByRole('status').textContent).toBe('Copying availability');

  finishRefresh({ days: [availableDay], now: new Date(2026, 7, 24, 10) });
  const copied = await screen.findByRole('button', {
    name: 'Today availability copied',
  });
  expect(copied).toBe(initial);
  expect(
    copied.querySelector('span[aria-hidden]')?.children[2].className
  ).toContain('opacity-100');
  expect(copied.getAttribute('aria-busy')).toBe('false');
});
it('does not copy when a fresh check finds no availability', async () => {
  mocks.refreshRange.mockResolvedValue({
    days: [],
    now: new Date(2026, 7, 24, 10),
  });
  render(() => <CopyAvailabilityDialog open onOpenChange={vi.fn()} />);

  fireEvent.click(
    screen.getByRole('button', { name: 'Copy availability for Today' })
  );
  await waitFor(() => {
    expect(mocks.alert).toHaveBeenCalledWith('No free time in that range');
  });
  expect(mocks.refreshRange).toHaveBeenCalledWith('today');
  expect(mocks.writeClipboardData).not.toHaveBeenCalled();
});
it('disables empty ranges with an explanation while leaving others available', () => {
  mocks.days.mockReturnValue({
    today: [],
    thisWeek: [availableDay],
    next7Days: [availableDay],
    next14Days: [availableDay],
  });
  render(() => <CopyAvailabilityDialog open onOpenChange={vi.fn()} />);

  const today = screen.getByRole('button', {
    name: 'Copy availability for Today: No free time in this range',
  });
  expect(today.hasAttribute('disabled')).toBe(true);
  expect(today.className).toContain('disabled:opacity-50');
  const unavailableLabel = screen.getByText('Today: No free time');
  expect(unavailableLabel.closest('button')).toBe(today);
  expect(unavailableLabel.className).toContain('touch:flex');
  expect(unavailableLabel.querySelector('svg')).toBeTruthy();
  expect(screen.queryByText('No free time', { exact: true })).toBeNull();
  fireEvent.click(today);
  expect(mocks.writeClipboardData).not.toHaveBeenCalled();
  expect(
    screen
      .getByRole('button', { name: 'Copy availability for This week' })
      .hasAttribute('disabled')
  ).toBe(false);
});

it('disables all options while checking availability', () => {
  mocks.days.mockReturnValue(undefined);
  render(() => <CopyAvailabilityDialog open onOpenChange={vi.fn()} />);

  const buttons = screen.getAllByRole('button', {
    name: /Checking availability/,
  });
  expect(buttons).toHaveLength(4);
  expect(buttons.every((button) => button.hasAttribute('disabled'))).toBe(true);
});
it('offers retry when loading availability fails', () => {
  mocks.days.mockReturnValue(undefined);
  mocks.isError.mockReturnValue(true);
  render(() => <CopyAvailabilityDialog open onOpenChange={vi.fn()} />);

  expect(
    screen.getAllByRole('button', { name: /Could not check availability/ })
  ).toHaveLength(4);
  expect(screen.getByRole('alert').textContent).toContain(
    'Could not load availability'
  );
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(mocks.retry).toHaveBeenCalledOnce();
});
