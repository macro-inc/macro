import { expect, type Page, test } from '@playwright/test';
import { answerCalendar, weeklyReview } from './calendar-routes';
import { openFixture } from './serve-from-node';

/** Opens the weekly review, noon to one on a Wednesday, in the composer. */
async function editWeeklyReview(page: Page) {
  await openFixture(page, '/composer.html');
  await page.getByRole('button', { name: 'Weekly review' }).click();
  const composer = page.getByRole('region', { name: 'Event composer' });
  await expect(composer.getByLabel('Title')).toHaveValue('Weekly review');
  return composer;
}

const saves = (page: Page) => page.getByRole('status', { name: 'Saves' });

test.describe('editing an event in the composer', () => {
  // Class web-cal-composer-logic: when this fails, a weekly series with no
  // weekday in its rule shows as plain "Weekly" instead of naming the day it
  // falls on, or moving the start leaves the end behind, so a one-hour
  // meeting is saved half an hour long.
  test('a weekly series names its weekday, and the end moves with the start', async ({
    page,
  }) => {
    const calendar = await answerCalendar(page, { events: [weeklyReview()] });
    const composer = await editWeeklyReview(page);

    await expect(
      composer.getByRole('button', { name: 'Repeats Weekly on Wednesday' })
    ).toBeVisible();

    const start = composer.getByRole('combobox', { name: 'event start time' });
    await start.click();
    await page.getByRole('option', { name: '12:30 PM' }).click();
    await expect(start).toHaveValue('12:30 PM');
    await expect(
      composer.getByRole('combobox', { name: 'event end time' })
    ).toHaveValue('1:30 PM');

    await composer.getByRole('button', { name: 'Save' }).click();
    await expect(saves(page)).toHaveText('Saved 1');
    expect(calendar.patches).toHaveLength(1);
    const time = calendar.patches[0].body.time as {
      startsAt: string;
      endsAt: string;
    };
    expect(new Date(time.startsAt).toISOString()).toBe(
      '2030-01-02T17:30:00.000Z'
    );
    expect(new Date(time.endsAt).toISOString()).toBe(
      '2030-01-02T18:30:00.000Z'
    );
  });

  // Class web-cal-mutation-completion: when this fails, a save the provider
  // has already answered stays pending until the calendar has been read
  // again, so the composer sits on a disabled Save for as long as that read
  // takes.
  test('a save is done when the provider answers, not when the calendar has reloaded', async ({
    page,
  }) => {
    const calendar = await answerCalendar(page, { events: [weeklyReview()] });
    const composer = await editWeeklyReview(page);
    await composer.getByLabel('Title').fill('Weekly sync');

    const reload = calendar.holdReads();
    await composer.getByRole('button', { name: 'Save' }).click();

    await expect(saves(page)).toHaveText('Saved 1');
    await expect(composer).toBeHidden();
    expect(calendar.patches).toHaveLength(1);
    // The reload the save started is still unanswered here.
    await reload.held;
    await reload.release();
    await expect(
      page.getByRole('button', { name: 'Weekly sync' })
    ).toBeVisible();
  });

  // Class cal-unreachable-behind-gateway: when this fails, the app asks for
  // the calendar list and sends event changes to a path the gateway does not
  // route to the calendar service, so the calendar cannot be read or changed.
  test("the calendar list and an event change go to the gateway's /calendar route", async ({
    page,
  }) => {
    const calendar = await answerCalendar(page, { events: [weeklyReview()] });
    const composer = await editWeeklyReview(page);
    await composer.getByLabel('Title').fill('Weekly sync');
    await composer.getByRole('button', { name: 'Save' }).click();
    await expect(saves(page)).toHaveText('Saved 1');

    expect(calendar.patches.map((patch) => patch.path)).toEqual([
      '/calendar/events/event-weekly',
    ]);
    expect(new Set(calendar.calendarListReads)).toEqual(
      new Set(['/calendar/calendars'])
    );
  });
});
