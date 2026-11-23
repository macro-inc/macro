import { expect, type Page, test } from '@playwright/test';
import { answerCalendar, organizedEvent } from './calendar-routes';
import { openFixture } from './serve-from-node';

const CAPABILITIES = {
  autoDecline: true,
  emailReminders: true,
  customRecurrence: true,
  removeConference: true,
  resetRsvp: true,
  guestPolicy: true,
  conferenceProvider: 'google_meet',
};

/** Two Google calendars of one inbox, in their providers' colors. */
const calendars = () => [
  {
    id: 'calendar-1',
    provider: 'google',
    name: 'Work',
    color: '#9fe1e7',
    emailAddress: 'viewer@example.com',
    emailLinkId: 'link-1',
    isPrimary: true,
    isSubscription: false,
    isWritable: true,
    contributesToAvailability: true,
    defaultReminders: [],
    capabilities: CAPABILITIES,
  },
  {
    id: 'calendar-2',
    provider: 'google',
    name: 'Team',
    color: '#f6bf26',
    emailAddress: 'viewer@example.com',
    emailLinkId: 'link-1',
    isPrimary: false,
    isSubscription: false,
    isWritable: true,
    contributesToAvailability: true,
    defaultReminders: [],
    capabilities: CAPABILITIES,
  },
];

const planning = () =>
  organizedEvent({
    id: 'event-planning',
    title: 'Planning',
    startsAt: '2030-01-03T15:00:00Z',
    endsAt: '2030-01-03T16:00:00Z',
    calendarIds: ['calendar-1'],
  });

async function openColors(page: Page) {
  // The calendar only reads ranges near today.
  await page.clock.setFixedTime(new Date('2030-01-02T15:00:00Z'));
  const server = await answerCalendar(page, {
    events: [planning()],
    calendars: calendars(),
  });
  await openFixture(page, '/colors.html');
  await page.getByRole('button', { name: 'Expand viewer@example.com' }).click();
  return server;
}

test.describe("a calendar's color in the sidebar", () => {
  // Class web-cal-calendar-color: when this fails, clicking a calendar's
  // square in the sidebar opens nothing, its events keep the provider's
  // color, or the choice is kept only until the page reloads.
  test('picks a color for the calendar and every one of its events, kept for the account', async ({
    page,
  }) => {
    const server = await openColors(page);
    const event = page.locator('.fc-event', { hasText: 'Planning' });
    await expect(event).toHaveCSS('--event-calendar-color', '#9fe1e7');

    await page
      .getByRole('button', { name: 'Color for Work (viewer@example.com)' })
      .click();
    const saved = page.waitForResponse('**/calendar/calendars/*/color');
    await page.getByRole('button', { name: 'Iris' }).click();

    await expect(event).toHaveCSS('--event-calendar-color', '#9382e8');
    // The grid recolors before the save reaches the server.
    await saved;
    expect(server.colorWrites).toEqual([
      { calendarId: 'calendar-1', color: '#9382e8' },
    ]);
    await expect(page.getByRole('checkbox', { name: 'Work' })).toBeChecked();

    // A fresh load reads the color from the account, not this page.
    await openFixture(page, '/colors.html');
    await page
      .getByRole('button', { name: 'Expand viewer@example.com' })
      .click();
    await expect(event).toHaveCSS('--event-calendar-color', '#9382e8');
  });

  // Class web-cal-calendar-color: when this fails, a calendar that was
  // given its own color cannot go back to the provider's.
  test("resets the calendar to the provider's color", async ({ page }) => {
    const server = await openColors(page);
    const event = page.locator('.fc-event', { hasText: 'Planning' });
    const picker = page.getByRole('button', {
      name: 'Color for Work (viewer@example.com)',
    });
    await picker.click();
    await page.getByRole('button', { name: 'Sage' }).click();
    await expect(event).toHaveCSS('--event-calendar-color', '#8bbf96');

    const reset = page.waitForResponse(
      (response) =>
        response.url().endsWith('/color') &&
        response.request().postDataJSON()?.color === null
    );
    await page
      .getByRole('button', {
        name: 'Reset Color for Work (viewer@example.com)',
      })
      .click();

    await expect(event).toHaveCSS('--event-calendar-color', '#9fe1e7');
    await reset;
    expect(server.colorWrites.at(-1)).toEqual({
      calendarId: 'calendar-1',
      color: null,
    });
  });

  // Class web-cal-calendar-color: when this fails, the checkbox or the name
  // beside a calendar's square stops showing and hiding the calendar.
  test('leaves showing and hiding the calendar to its checkbox and name', async ({
    page,
  }) => {
    await openColors(page);
    const event = page.locator('.fc-event', { hasText: 'Planning' });
    await expect(event).toHaveCount(1);

    await page.getByText('Work', { exact: true }).click();

    await expect(event).toHaveCount(0);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
});
