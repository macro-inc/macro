import { expect, test } from '@playwright/test';

// Class web-cal-create-latency: when this fails, a calendar create is not
// handed back as saved until the server answers (the event dialog closes on
// that hand-back), a create the server refuses stays on the calendar, or a
// landed create's local id no longer leads to the id the server gave it.
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
      beforeAnswer: { settled: false, creating: true },
      landedUnder: true,
      creating: false,
    });
  });

  test('leaves the calendar when the server refuses it', async ({ page }) => {
    const outcome = await page.evaluate(() =>
      window.calendarCreate.run('refuse')
    );
    expect(outcome).toEqual({
      beforeAnswer: { settled: false, creating: true },
      refused: 'read_only',
      creating: false,
    });
  });
});
