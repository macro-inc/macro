import { expect, test } from '@playwright/test';

for (const theme of ['dark', 'light']) {
  test(`live suggestions dismiss, undo, and open in the full feed in ${theme}`, async ({
    page,
  }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`/?theme=${theme}`);
    await expect(page.locator('[data-focus-row]')).toHaveCount(5);
    await page.screenshot({ path: testInfo.outputPath(`home-${theme}.png`) });
    await page
      .getByRole('button', {
        name: 'Dismiss: Review the pending request',
        exact: true,
      })
      .click();
    await expect(page.locator('[data-focus-row]')).toHaveCount(4);
    await page.getByRole('button', { name: 'Undo last', exact: true }).click();
    await expect(page.locator('[data-focus-row]')).toHaveCount(5);
    await page
      .getByRole('button', {
        name: 'Dismiss: Create an account research agent',
        exact: true,
      })
      .click();
    await page
      .getByRole('button', {
        name: 'Open suggestion: Prepare a weekly review',
        exact: true,
      })
      .click();
    await expect(
      page.locator('[data-feed-item="weekly-routine"]')
    ).toBeInViewport();
    await expect(page.locator('[data-feed-item="account-agent"]')).toHaveCount(
      0
    );
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}

test('opens the full feed from the priorities heading', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open For you', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'For you', exact: true })
  ).toBeVisible();
  await expect(page.locator('[data-feed-item]')).toHaveCount(5);
});

test('late data, keyboard selection, and full-page handoff', async ({
  page,
}) => {
  await page.goto('/?scenario=loading');
  await expect(page.locator('[data-focus-row]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Finish loading' }).click();
  await page
    .getByRole('button', {
      name: 'Open suggestion: Review the pending request',
      exact: true,
    })
    .focus();
  await page.keyboard.press('j');
  await expect(
    page.getByRole('button', {
      name: 'Open suggestion: Create an account research agent',
      exact: true,
    })
  ).toBeFocused();
  await page.keyboard.press('e');
  await expect(page.locator('[data-focus-row]')).toHaveCount(4);
  await page.keyboard.press('j');
  await page.keyboard.press('Enter');
  await expect(
    page.locator('[data-feed-item="pipeline-database"]')
  ).toBeInViewport();
});

test('failed suggestions retry without showing sample rows', async ({
  page,
}) => {
  await page.goto('/?scenario=error');
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.locator('[data-focus-row]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.locator('[data-focus-row]')).toHaveCount(5);
});

test('keyboard navigation accepts generated IDs with selector punctuation', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/?scenario=escaped-id');
  await page
    .getByRole('button', {
      name: 'Open suggestion: Review the pending request',
      exact: true,
    })
    .focus();
  await page.keyboard.press('j');
  await expect(
    page.getByRole('button', {
      name: 'Open suggestion: Create an account research agent',
      exact: true,
    })
  ).toBeFocused();
  expect(errors).toEqual([]);
});

test('today overview shows the whole day without internal scrolling', async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date('2026-11-02T11:15:00'));
  await page.goto('/');
  const calendar = page.getByRole('region', {
    name: "Today's calendar",
    exact: true,
  });
  const scroller = calendar.locator(
    '.fc-timegrid .fc-scroller-harness-liquid > .fc-scroller'
  );
  await expect(calendar.locator('.fc-timegrid-now-indicator-line')).toHaveCount(
    1
  );
  await expect(
    calendar.getByText('Morning sync', { exact: true })
  ).toBeVisible();
  await expect(
    calendar.getByText('End-of-day review', { exact: true })
  ).toBeVisible();
  await expect
    .poll(() => scroller.evaluate((el) => el.scrollHeight - el.clientHeight))
    .toBeLessThanOrEqual(1);
  expect(
    await calendar.evaluate((el) =>
      Math.round(el.getBoundingClientRect().height)
    )
  ).toBe(360);
  const bounds = await calendar.evaluate((root) => {
    const viewport = root.getBoundingClientRect();
    return [...root.querySelectorAll('.fc-event')].every((event) => {
      const box = event.getBoundingClientRect();
      return box.top >= viewport.top && box.bottom <= viewport.bottom;
    });
  });
  expect(bounds).toBe(true);
  await calendar.getByText('Design review', { exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('11:00 – 11:45 AM');
  await page.getByRole('button', { name: 'Close event' }).click();
  await scroller.hover();
  await page.mouse.wheel(0, 300);
  expect(await scroller.evaluate((el) => el.scrollTop)).toBe(0);
  await expect(calendar.locator('.fc-event')).toHaveCount(7);
  await expect(page.locator('[data-focus-row]')).toHaveCount(5);
});
