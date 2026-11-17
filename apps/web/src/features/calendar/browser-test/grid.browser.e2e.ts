import { expect, type Locator, type Page, test } from '@playwright/test';
import { answerCalendar, organizedEvent } from './calendar-routes';
import { openFixture } from './serve-from-node';

// Friday 10:00 to Sunday 20:00, New York time: three days, across the end of
// the week of 30 December 2029.
const offsite = () =>
  organizedEvent({
    id: 'event-offsite',
    title: 'Offsite',
    startsAt: '2030-01-04T15:00:00Z',
    endsAt: '2030-01-07T01:00:00Z',
  });

// One hour on Wednesday, on two of the viewer's calendars.
const standup = () =>
  organizedEvent({
    id: 'event-standup',
    title: 'Standup',
    startsAt: '2030-01-02T15:00:00Z',
    endsAt: '2030-01-02T16:00:00Z',
    calendarIds: ['calendar-1', 'calendar-2'],
  });

async function openGrid(page: Page, view: 'week' | 'month') {
  // The calendar only reads ranges near today.
  await page.clock.setFixedTime(new Date('2030-01-02T15:00:00Z'));
  await answerCalendar(page, { events: [offsite(), standup()] });
  await openFixture(page, `/grid.html?view=${view}`);
}

async function edges(locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error('not on screen');
  return { left: box.x, right: box.x + box.width };
}

test.describe('events on the calendar grid', () => {
  // Class web-cal-grid-rendering: when this fails, a timed event that runs
  // over several days is cut into a tall block per day in the hour grid (or
  // sits on the wrong days) instead of one bar in the all-day row across the
  // days it covers.
  test('a three-day timed event is one bar across its days in the week', async ({
    page,
  }) => {
    await openGrid(page, 'week');

    const bars = page.locator('.fc-daygrid-event', { hasText: 'Offsite' });
    await expect(bars).toHaveCount(1);
    await expect(
      page.locator('.fc-timegrid-event', { hasText: 'Offsite' })
    ).toHaveCount(0);

    const bar = await edges(bars);
    const friday = await edges(
      page.getByRole('columnheader', { name: 'January 4, 2030' })
    );
    const saturday = await edges(
      page.getByRole('columnheader', { name: 'January 5, 2030' })
    );
    expect(Math.abs(bar.left - friday.left)).toBeLessThan(12);
    expect(Math.abs(bar.right - saturday.right)).toBeLessThan(12);
  });

  // Class web-cal-grid-rendering: when this fails, a meeting that is on two
  // of the viewer's calendars is drawn as two blocks side by side.
  test('a meeting on two of the calendars is one block', async ({ page }) => {
    await openGrid(page, 'week');

    await expect(
      page.locator('.fc-timegrid-event', { hasText: 'Standup' })
    ).toHaveCount(1);
  });

  // Class web-cal-grid-rendering: when this fails, the month shows a
  // multi-day event with a piece missing or repeated in a week row, or the
  // two-calendar meeting twice.
  test('the month shows one piece of a multi-day event per week row', async ({
    page,
  }) => {
    await openGrid(page, 'month');

    await expect(
      page.locator('.fc-daygrid-event', { hasText: 'Offsite' })
    ).toHaveCount(2);
    await expect(
      page.locator('.fc-daygrid-event', { hasText: 'Standup' })
    ).toHaveCount(1);
  });
});
