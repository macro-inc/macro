import { expect, test } from '@playwright/test';

test.beforeEach(({ page }) => {
  page.on('pageerror', (error) => {
    throw error;
  });
});
for (const theme of ['light', 'dark']) {
  test(`agent DM opens watch mode with ordinary header controls in ${theme}`, async ({
    page,
  }, testInfo) => {
    await page.goto(`/?dm&edit${theme === 'dark' ? '&dark' : ''}`);
    const header = page.getByTestId('dm-header');
    const call = header.getByRole('button', { name: 'Call', exact: true });
    const computer = header.getByRole('button', {
      name: 'View computer',
      exact: true,
    });
    await expect(call).toBeVisible();
    await expect(computer).toBeVisible();
    const bounds = await computer.boundingBox();
    const callBounds = await call.boundingBox();
    expect(
      bounds &&
        callBounds &&
        Math.abs(
          bounds.y + bounds.height / 2 - callBounds.y - callBounds.height / 2
        )
    ).toBeLessThanOrEqual(1);
    await computer.click();
    await expect(page.getByText('Simulated desktop · watch')).toBeVisible();
    await expect(page.getByLabel('Transport history')).toHaveText('watch');
    if (testInfo.project.name === 'desktop') {
      await page
        .getByRole('button', { name: 'Take control', exact: true })
        .click();
      await expect(page.getByText('Simulated desktop · control')).toBeVisible();
    } else {
      await expect(
        page.getByRole('button', { name: 'Take control', exact: true })
      ).toHaveCount(0);
      await expect(
        page.getByRole('button', { name: 'Request edit control', exact: true })
      ).toHaveCount(0);
    }
    await page
      .getByRole('button', { name: 'Close screen', exact: true })
      .click();
    await expect(computer).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth
      )
    ).toBe(false);
  });
}

test('DM readers get watch mode with no control action', async ({ page }) => {
  await page.goto('/?dm');
  await page
    .getByRole('button', { name: 'View computer', exact: true })
    .click();
  await expect(page.getByText('Simulated desktop · watch')).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Take control', exact: true })
  ).toHaveCount(0);
});
for (const state of [
  'off',
  'human',
  'unpaired',
  'no-screen',
  'no-access',
  'channel',
  'group',
]) {
  test(`does not add a header action for ${state}`, async ({ page }) => {
    await page.goto(`/?dm&${state}`);
    await expect(
      page.getByRole('button', { name: 'Call', exact: true })
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'View computer', exact: true })
    ).toHaveCount(0);
    await expect(page.getByLabel('Transport history')).toBeEmpty();
  });
}

test('canonical bot DMs share the same watch entry', async ({ page }) => {
  await page.goto('/?dm&bot');
  await page
    .getByRole('button', { name: 'View computer', exact: true })
    .click();
  await expect(page.getByText('Simulated desktop · watch')).toBeVisible();
});
