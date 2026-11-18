import { expect, type Locator, test } from '@playwright/test';

/** Whether two boxes overlap, with a pixel of tolerance for rounding. */
async function overlaps(a: Locator, b: Locator): Promise<boolean> {
  const [first, second] = await Promise.all([a.boundingBox(), b.boundingBox()]);
  if (!first || !second) throw new Error('missing box');
  return (
    first.x + first.width > second.x + 1 &&
    second.x + second.width > first.x + 1 &&
    first.y + first.height > second.y + 1 &&
    second.y + second.height > first.y + 1
  );
}

test('subagent rows read as a short label with a state, and keep the brief behind the disclosure', async ({
  page,
}) => {
  await page.goto('/subagent.html');
  const session = page.getByRole('region', { name: 'Agent session' });
  // The dev server transforms the app's modules on first load.
  await expect(session.locator('[data-subagent-row]').first()).toBeVisible({
    timeout: 30_000,
  });
  const width = await page.evaluate(() => document.documentElement.clientWidth);

  for (const [label, state] of [
    ['running', 'Running'],
    ['completed', 'Done'],
    ['failed', 'Failed'],
  ] as const) {
    const row = session.locator(`[data-subagent-row="${label}"]`);
    const trigger = row.getByRole('button').first();
    await expect(trigger).toContainText('List open pull requests');
    await expect(trigger).toContainText(state);
    await expect(trigger).not.toContainText('GitHub search tool');
    const box = await trigger.boundingBox();
    expect(box && box.x + box.width).toBeLessThanOrEqual(width);
  }

  // Without a description the brief's first line is the label, cut short
  // with room left for the state and the caret.
  const undescribed = session.locator('[data-subagent-row="undescribed"]');
  const trigger = undescribed.getByRole('button').first();
  const label = trigger.locator('span').first();
  const state = trigger.getByText('Done', { exact: true });
  await expect(state).toBeVisible();
  expect(await overlaps(label, state)).toBe(false);
  expect((await trigger.boundingBox())?.height).toBeLessThan(48);

  await trigger.click();
  await expect(
    undescribed.getByRole('heading', { name: 'Instructions' })
  ).toBeVisible();
  await expect(undescribed.getByText('Group them by label')).toBeVisible();
  await expect(
    undescribed.getByRole('heading', { name: 'Result' })
  ).toBeVisible();

  const chat = page.getByRole('region', { name: 'AI chat' });
  const described = chat.locator('[data-legacy-subagent-row="described"]');
  await expect(described).toContainText('List open pull requests');
  await expect(described).toContainText('Done');
  await expect(described).not.toContainText('GitHub search tool');
  const legacyUndescribed = chat.locator(
    '[data-legacy-subagent-row="undescribed"]'
  );
  const legacyState = legacyUndescribed.getByText('Done', { exact: true });
  expect(
    await overlaps(legacyUndescribed.locator('.truncate').first(), legacyState)
  ).toBe(false);
  await page.screenshot({
    path: test.info().outputPath('subagent-collapsed.png'),
    fullPage: true,
  });

  await described.getByRole('button').click();
  await expect(
    described.getByRole('heading', { name: 'Instructions' })
  ).toBeVisible();
  await expect(described.getByText(/Seven open pull requests/)).toBeVisible();
  await page.screenshot({
    path: test.info().outputPath('subagent-expanded.png'),
    fullPage: true,
  });
});
