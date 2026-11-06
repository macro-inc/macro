import { expect, type Page, type TestInfo, test } from '@playwright/test';

test.beforeEach(({ page }) => {
  page.on('pageerror', (error) => {
    throw error;
  });
});

async function openCard(page: Page, testInfo: TestInfo) {
  const portrait = page.getByTestId('portrait');
  if (testInfo.project.name === 'desktop')
    await portrait.click({ button: 'right' });
  else {
    const rect = await portrait.boundingBox();
    if (!rect) throw new Error('Portrait is missing');
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [
        { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 },
      ],
    });
    await expect(
      page.getByRole('button', { name: 'Show screen', exact: true })
    ).toBeVisible();
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: [],
    });
    await cdp.detach();
  }
}

test('portrait right-click or phone long-press opens watch mode without sending a DM', async ({
  page,
}, testInfo) => {
  await page.goto('/');
  await openCard(page, testInfo);
  await expect(
    page.getByRole('button', { name: 'Take control', exact: true })
  ).toHaveCount(0);
  await expect(page.getByLabel('DM requests')).toHaveText('0');
  await page.getByRole('button', { name: 'Show screen', exact: true }).click();
  await expect(page.getByText('Simulated desktop · watch')).toBeVisible();
  await expect(page.getByLabel('Transport history')).toHaveText('watch');
});

test('edit access offers control only on desktop and revocation returns to watch mode', async ({
  page,
}, testInfo) => {
  await page.goto('/?edit');
  await openCard(page, testInfo);
  if (testInfo.project.name === 'desktop') {
    await page
      .getByRole('button', { name: 'Take control', exact: true })
      .click();
    await expect(page.getByText('Simulated desktop · control')).toBeVisible();
    await page.evaluate(() =>
      window.dispatchEvent(new Event('fixture:revoke-control'))
    );
    await expect(page.getByText('Simulated desktop · watch')).toBeVisible();
  } else {
    await expect(
      page.getByRole('button', { name: 'Take control', exact: true })
    ).toHaveCount(0);
    await page
      .getByRole('button', { name: 'Show screen', exact: true })
      .click();
    await expect(page.getByText('Simulated desktop · watch')).toBeVisible();
  }
});

test('hover or tap preserves the existing card and respects the computer rollout', async ({
  page,
}, testInfo) => {
  await page.goto('/?off');
  if (testInfo.project.name === 'desktop')
    await page.getByTestId('portrait').hover();
  else await page.getByTestId('portrait').tap();
  await expect(page.getByText('Assistant', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Show screen', exact: true })
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Take control', exact: true })
  ).toHaveCount(0);
});
