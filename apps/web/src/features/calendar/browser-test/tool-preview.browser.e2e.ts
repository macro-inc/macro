import { expect, type Locator, type Page, test } from '@playwright/test';
import {
  answerCalendar,
  organizedEvent,
  outlookCalendar,
  type WireItem,
  weeklyReview,
} from './calendar-routes';
import { openFixture } from './serve-from-node';

async function openPreview(
  page: Page,
  timeFormat: '12-hour' | '24-hour',
  options: { events?: WireItem[]; created?: string } = {}
) {
  // The calendar only reads ranges near today.
  await page.clock.setFixedTime(new Date('2030-01-02T15:00:00Z'));
  await page.addInitScript(
    (format) =>
      localStorage.setItem(
        'macro:pref:calendar:settings',
        JSON.stringify({ timeFormat: format })
      ),
    timeFormat
  );
  await answerCalendar(page, {
    events: options.events ?? [],
    // The draft's calendar, in the color the fixture's form gives it.
    calendars: [{ ...outlookCalendar(), color: '#609fe2' }],
  });
  await openFixture(
    page,
    options.created
      ? `/tool-preview.html?created=${options.created}`
      : '/tool-preview.html'
  );
  await expect(page.getByText('Drafted review').first()).toBeVisible();
}

/** The event the draft became: the same hour, on the same calendar. */
const createdReview = () =>
  organizedEvent({
    id: 'event-created',
    title: 'Drafted review',
    startsAt: '2030-01-02T19:00:00Z',
    endsAt: '2030-01-02T20:00:00Z',
    calendarIds: ['calendar-1'],
  });

function chip(page: Page, title: string): Locator {
  return page.locator('.fc-event').filter({ hasText: title });
}

async function look(chip: Locator) {
  return chip.evaluate((element) => {
    const style = getComputedStyle(element);
    return { fill: style.backgroundColor, opacity: style.opacity };
  });
}

async function capture(page: Page, name: string) {
  const directory = process.env.CALENDAR_SCREENSHOT_DIR;
  if (directory) await page.screenshot({ path: `${directory}/${name}.png` });
}

test.describe("the agent card's preview of a drafted event", () => {
  // Class web-cal-grid-rendering: when this fails, the preview under an
  // agent's event draft labels its hours 2pm and its block 2–3pm on a
  // calendar set to 24-hour, while the form above it reads 14:00.
  test('labels its hours and the event on a 24-hour calendar’s clock', async ({
    page,
  }) => {
    await openPreview(page, '24-hour');
    await expect(
      page.getByText('14:00', { exact: true }).first()
    ).toBeVisible();
    await expect(page.getByText('14:00–15:00', { exact: true })).toBeVisible();
    await expect(page.getByText(/^\d{1,2}(:\d{2})?\s?(am|pm)$/i)).toHaveCount(
      0
    );
    await capture(page, 'tool-preview-24-hour');
  });

  test('keeps a 12-hour calendar on the 12-hour clock', async ({ page }) => {
    await openPreview(page, '12-hour');
    await expect(page.getByText('2pm', { exact: true }).first()).toBeVisible();
    await capture(page, 'tool-preview-12-hour');
  });

  // Class web-cal-grid-rendering: when this fails, a card whose event was
  // created shows the dark draft and the created event side by side.
  test('shows the created event in the draft’s place, in its calendar’s color', async ({
    page,
  }) => {
    await openPreview(page, '12-hour', {
      events: [weeklyReview(), createdReview()],
      created: 'event-created',
    });
    await expect(chip(page, 'Weekly review')).toHaveCount(1);
    await expect(chip(page, 'Drafted review')).toHaveCount(1);
    const created = await look(chip(page, 'Drafted review'));
    const other = await look(chip(page, 'Weekly review'));
    expect(created.fill).toBe(other.fill);
    expect(created.opacity).toBe('1');
    expect(Number(other.opacity)).toBeLessThan(1);
    await capture(page, 'tool-preview-created');
  });

  test('keeps the draft on a card that created nothing', async ({ page }) => {
    await openPreview(page, '12-hour', { events: [weeklyReview()] });
    await expect(chip(page, 'Weekly review')).toHaveCount(1);
    await expect(chip(page, 'Drafted review')).toHaveCount(1);
    const draft = await look(chip(page, 'Drafted review'));
    const other = await look(chip(page, 'Weekly review'));
    expect(draft.fill).not.toBe(other.fill);
    expect(draft.opacity).toBe('1');
    await capture(page, 'tool-preview-draft');
  });
});
