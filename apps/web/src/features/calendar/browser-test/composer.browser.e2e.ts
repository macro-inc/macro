import { expect, type Page, test } from '@playwright/test';
import {
  answerCalendar,
  designReview,
  outlookCalendar,
  weeklyReview,
} from './calendar-routes';
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

const TEAMS_REMOVAL_NOTICE =
  'Outlook can’t remove Teams from an existing event. To drop it, replace the event: guests get a new invitation with your changes and respond again.';

/** Saves a screenshot for wording review when CALENDAR_SCREENSHOT_DIR is set. */
async function capture(page: Page, name: string) {
  const directory = process.env.CALENDAR_SCREENSHOT_DIR;
  if (directory) await page.screenshot({ path: `${directory}/${name}.png` });
}

/** Opens the Teams design review in the composer and turns Teams off. */
async function turnOffTeams(page: Page) {
  await openFixture(page, '/composer.html');
  await page.getByRole('button', { name: 'Design review' }).click();
  const composer = page.getByRole('region', { name: 'Event composer' });
  await expect(composer.getByLabel('Title')).toHaveValue('Design review');
  const meeting = composer.getByRole('button', { name: /Video conferencing/ });
  await expect(meeting).toContainText('Microsoft Teams');
  await meeting.click();
  await page.getByRole('option', { name: 'No meeting link' }).click();
  await expect(meeting).toContainText('No meeting link');
  return composer;
}

test.describe('removing Teams from an Outlook meeting', () => {
  // Class web-cal-replacement-edits: when this fails, turning Teams off
  // either saves a change Outlook refuses, or the replacement is prepared
  // from the saved event and drops the edits the organizer just made.
  test('Save waits for a replacement that carries the edits, and Undo keeps the meeting', async ({
    page,
  }) => {
    const calendar = await answerCalendar(page, {
      events: [designReview()],
      calendars: [outlookCalendar()],
    });
    const composer = await turnOffTeams(page);
    const save = composer.getByRole('button', { name: 'Save' });
    const notice = composer.getByText(TEAMS_REMOVAL_NOTICE);

    await expect(notice).toBeVisible();
    await expect(save).toBeDisabled();
    await capture(page, 'desktop-notice');
    await composer.getByRole('button', { name: 'Undo' }).click();
    await expect(notice).toHaveCount(0);
    await expect(
      composer.getByRole('button', { name: /Video conferencing/ })
    ).toContainText('Microsoft Teams');
    await expect(save).toBeEnabled();

    await composer.getByLabel('Title').fill('Design review, moved');
    await composer.getByRole('button', { name: /Video conferencing/ }).click();
    await page.getByRole('option', { name: 'No meeting link' }).click();
    await composer.getByRole('button', { name: 'Replace event…' }).click();

    const dialog = page.getByRole('dialog');
    await expect(
      dialog.getByText('Design review, moved', { exact: true })
    ).toBeVisible();
    // The time reads as the event card writes it.
    await expect(
      dialog.getByText('Fri, January 4 · 10:00 AM–11:00 AM', { exact: true })
    ).toBeVisible();
    await capture(page, 'desktop-dialog');
    expect(calendar.replacements).toEqual([
      {
        action: 'prepare',
        body: {
          calendarId: 'calendar-1',
          removeConference: true,
          changes: { title: 'Design review, moved' },
        },
      },
    ]);
    await dialog
      .getByRole('checkbox', {
        name: 'I understand this cancels the old invitation and sends a new one.',
      })
      .check();
    await dialog
      .getByRole('button', { name: 'Replace event', exact: true })
      .click();
    await expect(
      dialog.getByRole('status').filter({ hasText: 'Replacement complete' })
    ).toBeVisible();
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(composer).toHaveCount(0);
    expect(calendar.replacements.map(({ action }) => action)).toEqual([
      'prepare',
      'confirm',
    ]);
    expect(calendar.patches).toEqual([]);
  });

  test.describe('on a phone', () => {
    test.use({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
    });

    test('the notice stacks under the fields with its actions in reach', async ({
      page,
    }) => {
      await answerCalendar(page, {
        events: [designReview()],
        calendars: [outlookCalendar()],
      });
      const composer = await turnOffTeams(page);
      const notice = composer.getByRole('status').filter({
        hasText: TEAMS_REMOVAL_NOTICE,
      });

      await notice.scrollIntoViewIfNeeded();
      const box = await notice.boundingBox();
      expect(box && box.x >= 0 && box.x + box.width <= 390).toBe(true);
      for (const name of ['Replace event…', 'Undo']) {
        const action = notice.getByRole('button', { name });
        await expect(action).toBeVisible();
        const actionBox = await action.boundingBox();
        expect(actionBox && actionBox.x + actionBox.width <= 390).toBe(true);
      }
      await expect(page.getByRole('button', { name: 'Save' })).toBeDisabled();
      await capture(page, 'phone-notice');
    });
  });
});

test.describe('a calendar set to the 24-hour clock', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() =>
      localStorage.setItem(
        'macro:pref:calendar:settings',
        JSON.stringify({ timeFormat: '24-hour' })
      )
    );
  });

  // Class web-cal-composer-logic: when this fails, the editor's start and end
  // read 12:00 PM on a calendar set to 24-hour, while the grid and the event
  // card read 12:00.
  test('the editor shows and lists its times on that clock', async ({
    page,
  }) => {
    await answerCalendar(page, { events: [weeklyReview()] });
    const composer = await editWeeklyReview(page);
    const start = composer.getByRole('combobox', { name: 'event start time' });
    const end = composer.getByRole('combobox', { name: 'event end time' });
    await expect(start).toHaveValue('12:00');
    await expect(end).toHaveValue('13:00');

    await start.click();
    await page.getByRole('option', { name: '12:30', exact: true }).click();
    await expect(start).toHaveValue('12:30');
    await expect(end).toHaveValue('13:30');
    await end.click();
    await expect(page.getByRole('option', { name: /^14:30/ })).toBeVisible();
    await expect(page.getByRole('option', { name: /PM/ })).toHaveCount(0);
    await capture(page, 'desktop-24-hour');
  });

  test.describe('on a phone', () => {
    test.use({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
    });

    test('the editor shows its times on that clock', async ({ page }) => {
      await answerCalendar(page, { events: [weeklyReview()] });
      const composer = await editWeeklyReview(page);
      await expect(
        composer.getByRole('combobox', { name: 'event start time' })
      ).toHaveValue('12:00');
      await expect(
        composer.getByRole('combobox', { name: 'event end time' })
      ).toHaveValue('13:00');
      await capture(page, 'phone-24-hour');
    });
  });
});
