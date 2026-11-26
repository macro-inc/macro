import { expect, type Page, test } from '@playwright/test';

const SCREENSHOT_DIR = process.env.PR_COMMENTS_SCREENSHOT_DIR;

async function openAt(page: Page, width: number) {
  if (width > (page.viewportSize()?.width ?? 0)) {
    await page.setViewportSize({ width, height: 900 });
  }
  await page.context().route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === 'localhost') await route.continue();
    else await route.fulfill({ status: 404, body: '' });
  });
  await page.goto(
    `/src/features/block-pr/browser-test/changes-split.html?width=${width}`
  );
  const changes = page.getByRole('region', { name: 'Changes' });
  await expect(changes).toBeVisible({ timeout: 60_000 });
  return {
    changes,
    pullRequest: page.getByRole('region', { name: 'Pull request' }),
    sideBySide: changes.locator('[data-diff-type="split"]'),
    unified: changes.locator('[data-diff-type="single"]'),
  };
}

async function capture(page: Page, name: string) {
  if (!SCREENSHOT_DIR) return;
  await page.screenshot({ path: `${SCREENSHOT_DIR}/${name}.png` });
}

test.describe('desktop', () => {
  test.skip(({ isMobile }) => isMobile, 'desktop split widths');

  test('a PR split too narrow for both opens Changes over the PR', async ({
    page,
  }) => {
    const view = await openAt(page, 800);
    await expect(view.pullRequest).toBeHidden();
    await expect
      .poll(async () => (await view.changes.boundingBox())?.width)
      .toBeGreaterThan(780);
    await expect(view.sideBySide.first()).toBeVisible();
    await capture(page, 'changes-800');
  });

  test('beside Changes, the PR keeps the width its header needs', async ({
    page,
  }) => {
    const view = await openAt(page, 1100);
    await expect(view.pullRequest).toBeVisible();
    await expect
      .poll(async () => (await view.pullRequest.boundingBox())?.width)
      .toBeGreaterThanOrEqual(560);
    await expect(view.sideBySide.first()).toBeVisible();
    await capture(page, 'changes-1100');
  });

  test('a wide PR keeps Changes beside it, side by side', async ({ page }) => {
    const view = await openAt(page, 1600);
    await expect(view.pullRequest).toBeVisible();
    await expect(view.sideBySide.first()).toBeVisible();
    await capture(page, 'changes-1600');
  });
});

test('on a phone, Changes covers the PR with the unified diff', async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, 'phone only');
  const view = await openAt(page, 390);
  await expect(view.pullRequest).toBeHidden();
  await expect(view.unified.first()).toBeVisible();
  await capture(page, 'changes-phone');
});
