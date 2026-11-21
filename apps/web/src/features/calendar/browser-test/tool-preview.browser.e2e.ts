import { expect, type Page, test } from '@playwright/test';
import { answerCalendar } from './calendar-routes';
import { openFixture } from './serve-from-node';

async function openPreview(page: Page, timeFormat: '12-hour' | '24-hour') {
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
  await answerCalendar(page, { events: [] });
  await openFixture(page, '/tool-preview.html');
  await expect(page.getByText('Drafted review')).toBeVisible();
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
});
