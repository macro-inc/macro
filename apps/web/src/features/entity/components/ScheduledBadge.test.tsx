import { formatTimeZoneAbbreviation } from '@core/util/date';
import { cleanup, render } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ScheduledBadge } from './Badges';

vi.mock('@core/component/UserIcon', () => ({ UserIcon: () => null }));

// Thursday, Sep 24, 2026 at noon, local time.
const NOW = new Date(2026, 8, 24, 12, 0);

const label = (sendTime: Date) =>
  render(() => <ScheduledBadge sendTime={sendTime.toISOString()} />).container
    .textContent;

describe('ScheduledBadge', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('names the day relative to now for upcoming sends', () => {
    expect(label(new Date(2026, 8, 24, 14, 13))).toBe('Today, 2:13 PM');
    expect(label(new Date(2026, 8, 25, 14, 12))).toBe('Tomorrow, 2:12 PM');
    expect(label(new Date(2026, 8, 28, 9, 45))).toBe('Mon, 9:45 AM');
    expect(label(new Date(2026, 9, 24, 16, 30))).toBe('Oct 24, 4:30 PM');
    expect(label(new Date(2027, 0, 3, 11, 5))).toBe('Jan 3, 2027');
  });

  it('gives the full send time and its zone on hover', () => {
    const sendTime = new Date(2026, 8, 25, 14, 12);
    const { container } = render(() => (
      <ScheduledBadge sendTime={sendTime.toISOString()} />
    ));
    expect(container.firstElementChild?.getAttribute('title')).toBe(
      `Scheduled to send Fri, Sep 25, 2026 at 2:12 PM ${formatTimeZoneAbbreviation(sendTime)}`
    );
  });

  it('keeps an overdue send on its date instead of a weekday', () => {
    const lastMonth = new Date(2026, 7, 31, 9, 0);
    expect(label(lastMonth)).toBe('Aug 31, 9:00 AM');
    const { container } = render(() => (
      <ScheduledBadge sendTime={lastMonth.toISOString()} />
    ));
    expect(container.firstElementChild?.className).toContain('text-failure');
  });
});
