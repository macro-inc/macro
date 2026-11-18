import { expect, test } from '@playwright/test';

// West of Greenwich, where a whole-day chip read as UTC midnight showed
// "Yesterday" for today.
test.use({ timezoneId: 'America/Los_Angeles' });

test('whole-day and timed date chips label today as Today', async ({
  page,
  context,
}, testInfo) => {
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (
      url.hostname === 'localhost' &&
      !url.pathname.includes('/__macro_dev/')
    ) {
      await route.continue();
    } else {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: '{}',
      });
    }
  });
  await page.routeWebSocket('**/*', (socket) => socket.close());
  // Thursday, 1:03 PM in Los Angeles.
  await page.clock.setFixedTime(new Date('2026-09-24T20:03:00Z'));
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(
    '/src/lib/core/component/LexicalMarkdown/component/core/browser-test/date-chips.html'
  );

  const wholeDay = page.getByTestId('whole-day').locator('[data-date-mention]');
  await expect(wholeDay).toHaveText('Today', { timeout: 30_000 });
  await expect(wholeDay).toHaveAttribute('data-date', '2026-09-24');
  await expect(
    page.getByTestId('timed').locator('[data-date-mention]')
  ).toHaveText('Today');
  expect(errors).toEqual([]);
  await page.screenshot({
    path: testInfo.outputPath(`date-chips-${testInfo.project.name}.png`),
  });
});
