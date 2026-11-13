import { expect, type Page, test } from '@playwright/test';
import type { RowState } from './access-request';

const LONG_NAME =
  'Alexandra Konstantinopoulou-Vanderbilt de la Fontaine Montgomery';

async function rowBox(page: Page) {
  const box = await page.locator('[data-system-activity]').boundingBox();
  if (!box) throw new Error('The request row is not rendered');
  return box;
}

// The channel list measures a row once when it mounts, so nothing the row
// learns afterwards may change its height.
test('a request to join keeps its first height through every later state', async ({
  page,
}) => {
  await page.goto('/access-request.html');
  const { height } = await rowBox(page);

  const states: Partial<RowState>[] = [
    { requesterName: LONG_NAME },
    { outcome: { kind: 'pending', canAnswer: false } },
    { outcome: { kind: 'pending', canAnswer: true } },
    { busy: true },
    { busy: false, outcome: { kind: 'approved', by: LONG_NAME } },
    { outcome: { kind: 'denied', by: LONG_NAME } },
    { outcome: { kind: 'withdrawn' } },
    { outcome: { kind: 'unavailable' } },
  ];
  for (const state of states) {
    await page.evaluate((next) => window.update(next), state);
    expect((await rowBox(page)).height, JSON.stringify(state)).toBe(height);
  }
});

// Buttons grow to 36px on touch; the answer line grows with them.
test('the answer buttons fit inside their line', async ({ page, isMobile }) => {
  await page.goto('/access-request.html');
  expect(
    await page.evaluate(() => document.documentElement.dataset.touchDevice)
  ).toBe(String(isMobile));
  await page.evaluate(() =>
    window.update({ outcome: { kind: 'pending', canAnswer: true } })
  );
  const approve = page.getByRole('button', { name: 'Approve' });
  const button = await approve.boundingBox();
  const line = await approve.locator('..').boundingBox();
  if (!button || !line) throw new Error('Approve is not rendered');

  expect(button.y).toBeGreaterThanOrEqual(line.y);
  expect(button.y + button.height).toBeLessThanOrEqual(line.y + line.height);
});
