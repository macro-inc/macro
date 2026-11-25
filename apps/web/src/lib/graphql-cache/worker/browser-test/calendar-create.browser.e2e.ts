import { expect, test } from '@playwright/test';

// Class web-cal-create-latency: when this fails, a calendar create is not
// handed back as saved until the server answers (the event dialog closes on
// that hand-back), a create on the dialog's calendar waits on a calendar list
// read, a create the server refuses stays on the calendar, a landed create's
// local id no longer leads to the id the server gave it or to the copy its
// answer carried (open details show it), or the local copy names a time zone
// the server's never does (its details then show an "Original time").
test.describe('a calendar create through the real cache and queue', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('calendar-create.html');
    await expect(page.locator('#result')).toHaveAttribute(
      'data-status',
      'ready',
      { timeout: 60_000 }
    );
  });

  test('is saved locally before the server answers, then lands under the server id', async ({
    page,
  }) => {
    const outcome = await page.evaluate(() =>
      window.calendarCreate.run('create')
    );
    expect(outcome).toEqual({
      beforeAnswer: {
        settled: false,
        creating: true,
        calendarListReads: 1,
        localTimeZone: null,
      },
      landedUnder: true,
      answeredWithServerCopy: true,
      creating: false,
    });
  });

  test.describe('in a browser outside UTC', () => {
    test.use({ timezoneId: 'America/New_York' });

    test('queues the dialog’s calendar without reading the calendar list, with no time zone on the local occurrence', async ({
      page,
    }) => {
      const outcome = await page.evaluate(() =>
        window.calendarCreate.run('create', { knownCalendar: true })
      );
      expect(outcome).toEqual({
        beforeAnswer: {
          settled: false,
          creating: true,
          calendarListReads: 0,
          localTimeZone: null,
        },
        landedUnder: true,
        answeredWithServerCopy: true,
        creating: false,
      });
    });
  });

  // Class web-cal-move-details: when this fails, details opened on an event
  // just moved close once the move saves, because nothing says which
  // occurrence the server keyed anew in place of the moved one.
  test('when moved, is followed from the moved occurrence to the one the server keys anew', async ({
    page,
  }) => {
    const outcome = await page.evaluate(() => window.calendarCreate.move());
    expect(outcome).toEqual({
      beforeAnswer: { moving: true, shown: ['moved occurrence'] },
      announced: ['2026-11-28T15:00:00+00:00 -> 2026-11-28T16:00:00+00:00'],
      moving: false,
    });
  });

  test('leaves the calendar when the server refuses it', async ({ page }) => {
    const outcome = await page.evaluate(() =>
      window.calendarCreate.run('refuse')
    );
    expect(outcome).toEqual({
      beforeAnswer: {
        settled: false,
        creating: true,
        calendarListReads: 1,
        localTimeZone: null,
      },
      refused: 'read_only',
      creating: false,
    });
  });
});
