import path from 'node:path';
import { expect, type Page, test } from '@playwright/test';

const fixture = '/src/features/scheduling/browser-test/index.html';
const screenshots = process.env.SCHEDULING_SCREENSHOT_DIR;

async function capture(page: Page, name: string) {
  if (screenshots)
    await page.screenshot({ path: path.join(screenshots, `${name}.png`) });
}

/** The details step of the fixture's public page, for a time next month. */
async function details(page: Page) {
  await page.clock.install();
  await page.goto(fixture);
  await page.getByRole('button', { name: 'Public booking page' }).click();
  await page
    .getByRole('button', { name: /30 minute meeting/ })
    .first()
    .click();
  await page.getByRole('button', { name: 'Next month' }).click();
  await page.getByRole('button', { name: /\b15, \d{4}$/ }).click();
  await page.getByRole('button', { name: /^2:00\sPM$/ }).click();
  await page.getByLabel('Name').fill('Grace Hopper');
  await page.getByLabel('Email address').fill('grace@example.com');
}

const confirm = (page: Page) =>
  page.getByRole('button', { name: 'Confirm booking' }).click();

test('a booking whose answer was lost finishes by itself', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 820 });
  await details(page);
  await page
    .getByRole('button', { name: 'Simulate lost booking response' })
    .click();
  await confirm(page);

  await expect(page.getByText('Finishing your booking')).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Finishing booking…' })
  ).toBeDisabled();
  await expect(
    page.getByRole('button', { name: '← Choose another time' })
  ).toBeDisabled();
  await capture(page, 'finishing-desktop');

  await page.clock.runFor(1000);
  await expect(
    page.getByRole('heading', { name: 'You’re booked' })
  ).toBeVisible();
});

test('a booking that stays unanswered says it is taking longer, then finishes', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 820 });
  await details(page);
  const lose = page.getByRole('button', {
    name: /Simulate lost booking response|Losing \d+ booking answers/,
  });
  for (let i = 0; i < 5; i++) await lose.click();
  await confirm(page);

  await page.clock.runFor(1000 + 2000 + 4000);
  await expect(page.getByText('Finishing your booking')).toBeVisible();
  await page.clock.runFor(8000);
  await expect(page.getByText('Still finishing your booking')).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await capture(page, 'still-finishing-desktop');

  await page.clock.runFor(15000);
  await expect(
    page.getByRole('heading', { name: 'You’re booked' })
  ).toBeVisible();
});

test('a booking left unanswered stops resending until the visitor tries again', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 820 });
  await details(page);
  const lose = page.getByRole('button', {
    name: /Simulate lost booking response|Losing \d+ booking answers/,
  });
  for (let i = 0; i < 7; i++) await lose.click();
  await confirm(page);

  await page.clock.runFor(1000 + 2000 + 4000 + 8000 + 15000 + 15000);
  await expect(
    page.getByText('We couldn’t finish your booking yet')
  ).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: '← Choose another time' })
  ).toBeDisabled();
  await capture(page, 'paused-desktop');

  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(
    page.getByRole('heading', { name: 'You’re booked' })
  ).toBeVisible();
});

test('the finishing state fits a phone', async ({ page }) => {
  // The fixture's frame does not scroll, so the phone gets a tall window.
  await page.setViewportSize({ width: 390, height: 1600 });
  await details(page);
  await page
    .getByRole('button', { name: 'Simulate lost booking response' })
    .click();
  await confirm(page);
  const status = page
    .getByRole('status')
    .filter({ hasText: 'Finishing your booking' });
  await expect(status).toBeVisible();
  await status.scrollIntoViewIfNeeded();
  const box = await status.boundingBox();
  expect(box?.width).toBeLessThanOrEqual(390);
  await capture(page, 'finishing-phone');
});

test('a receipt still processing says it updates by itself', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 820 });
  await details(page);
  await page.getByRole('button', { name: 'Book as still processing' }).click();
  await confirm(page);
  await expect(
    page.getByRole('heading', { name: 'Finishing your booking' })
  ).toBeVisible();
  await expect(
    page.getByText('this page updates by itself', { exact: false })
  ).toBeVisible();
  await capture(page, 'processing-receipt');
});
