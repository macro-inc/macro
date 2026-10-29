import { expect, type Page, test } from '@playwright/test';

// Budgets sit between the fixed path (about 0.1-0.5 s here) and the old one,
// which took 1.2-3 s per click on this fixture.
const SESSION_CLICK_BUDGET_MS = 1000;
const SCRUB_CLICK_BUDGET_MS = 1000;

async function timeUntilPainted(page: Page, action: () => Promise<void>) {
  const start = Date.now();
  await action();
  await page.evaluate(
    () =>
      new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve)))
  );
  return Date.now() - start;
}

test('opens, diffs, and scrubs a long history within budget', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/?sessions=300');

  const timeline = page.getByRole('complementary', {
    name: 'History timeline and sessions',
  });
  const sessions = timeline.getByRole('button');
  await expect(sessions.first()).toBeVisible({ timeout: 30_000 });
  expect(await sessions.count()).toBeGreaterThan(10);

  for (const row of [0, 4, 8]) {
    const elapsed = await timeUntilPainted(page, () =>
      sessions.nth(row).click()
    );
    expect(elapsed).toBeLessThan(SESSION_CLICK_BUDGET_MS);
  }
  await expect(page.locator('[data-diff-author]').first()).toBeVisible();

  const graph = await timeline.locator('div').first().boundingBox();
  if (!graph) throw new Error('timeline graph is not laid out');
  const preview = page.getByRole('region', { name: 'Version preview' });
  const previewTexts: string[] = [];
  for (const fraction of [0.1, 0.7, 0.3, 0.5]) {
    const elapsed = await timeUntilPainted(page, () =>
      page.mouse.click(
        graph.x + graph.width * fraction,
        graph.y + graph.height / 2
      )
    );
    expect(elapsed).toBeLessThan(SCRUB_CLICK_BUDGET_MS);
    previewTexts.push(await preview.innerText());
  }
  // Each position shows its own version: the history only adds text, so an
  // earlier position shows less of it.
  const [at10, at70, at30, at50] = previewTexts.map((text) => text.length);
  expect(at10).toBeLessThan(at30);
  expect(at30).toBeLessThan(at50);
  expect(at50).toBeLessThan(at70);
  expect(errors).toEqual([]);
});
