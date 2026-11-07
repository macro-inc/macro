import { expect, test } from '@playwright/test';

test.beforeEach(({ page }) => {
  page.on('pageerror', (error) => {
    throw error;
  });
});

for (const theme of ['light', 'dark']) {
  test(`computer purchase and release fit content in ${theme}`, async ({
    page,
  }) => {
    await page.goto(`/?purchase${theme === 'dark' ? '&dark' : ''}`);
    const standard = page.getByRole('radio', { name: 'Standard', exact: true });
    await standard.check();
    await expect(
      page.getByText('4 vCPU · 8 GiB memory · 100 GiB disk', { exact: true })
    ).toBeVisible();
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(
      dialog.getByText('Total per month', { exact: true })
    ).toBeVisible();
    await expect(dialog.getByText('$30.00', { exact: true })).toHaveCount(2);
    const buy = dialog.getByRole('button', {
      name: 'Buy · $30.00/month',
      exact: true,
    });
    const note = dialog.getByText(
      'Added to your team subscription, prorated for the rest of this billing period.',
      { exact: true }
    );
    const noteBox = await note.boundingBox();
    const input = dialog.getByRole('textbox');
    const inputBox = await input.boundingBox();
    expect(
      noteBox && inputBox && inputBox.y - noteBox.y - noteBox.height
    ).toBeLessThan(100);
    await input.fill('Build machine');
    await buy.click();
    await expect(page.getByRole('status')).toHaveText(
      'Purchases: 1 · Releases: 0'
    );
    await page
      .getByRole('button', { name: 'Release computer', exact: true })
      .click();
    const release = dialog.getByRole('button', {
      name: 'Release now',
      exact: true,
    });
    await expect(release).toBeDisabled();
    await dialog
      .getByPlaceholder('Build machine', { exact: true })
      .fill('build machine');
    await expect(release).toBeDisabled();
    await dialog
      .getByPlaceholder('Build machine', { exact: true })
      .fill('Build machine');
    await expect(release).toBeEnabled();
    expect((await dialog.boundingBox())?.height).toBeLessThan(620);
    await release.click();
    await expect(page.getByRole('status')).toHaveText(
      'Purchases: 1 · Releases: 1'
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth
      )
    ).toBe(false);
  });
}

test('included invitation retains its complete breakdown without an empty review area', async ({
  page,
}) => {
  await page.goto('/?included');
  await page.getByRole('button', { name: 'Invite agent', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill('Assistant');
  await page.getByLabel('Role / job description').fill('Engineer');
  await page.getByLabel('Personality').fill('Careful');
  await page.getByRole('button', { name: 'Review price', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Agent seat', { exact: true })).toBeVisible();
  await expect(
    dialog.getByText('Standard computer', { exact: true })
  ).toBeVisible();
  await expect(dialog.getByText('Included', { exact: true })).toHaveCount(3);
  await expect(
    dialog.getByText('Included for Macro', { exact: true })
  ).toBeVisible();
  const note = await dialog
    .getByText('No charge is added to your team subscription.', { exact: true })
    .boundingBox();
  const invite = dialog.getByRole('button', {
    name: 'Invite Assistant',
    exact: true,
  });
  const action = await invite.boundingBox();
  expect(note && action && action.y - note.y - note.height).toBeLessThan(70);
  await invite.click();
  await expect(page.getByText('Purchases: 1', { exact: true })).toContainText(
    'Purchases: 1'
  );
});

test('billing lists each computer once with catalog-consistent rows and retains legacy charges explicitly', async ({
  page,
}) => {
  await page.goto('/?billing');
  await expect(page.getByText('Computers', { exact: true })).toHaveCount(0);
  const row = page
    .getByLabel('Price breakdown')
    .locator(':scope > div')
    .filter({ has: page.getByText('Research agent · Large', { exact: true }) });
  await expect(row.getByText('$60.00', { exact: true })).toBeVisible();
  await expect(
    row.getByText('8 vCPU · 16 GiB memory · 200 GiB disk', { exact: true })
  ).toBeVisible();
  await expect(page.getByText('$220.00', { exact: true })).toBeVisible();
  await page.goto('/?billing&legacy');
  await expect(row.getByText('$30.00', { exact: true })).toBeVisible();
  await expect(
    row.getByText(
      'New computers: $60.00/month. Your subscribed price is retained.',
      { exact: true }
    )
  ).toBeVisible();
  await expect(page.getByText('$190.00', { exact: true })).toBeVisible();
});

test('a comped computer offer keeps its full breakdown through purchase', async ({
  page,
}) => {
  await page.goto('/?purchase&included');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Included', { exact: true })).toHaveCount(2);
  await expect(
    dialog.getByText('Included for Macro', { exact: true })
  ).toBeVisible();
  await expect(
    dialog.getByText('4 vCPU · 8 GiB memory · 100 GiB disk', { exact: true })
  ).toBeVisible();
  await dialog.getByRole('button', { name: 'Buy', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText(
    'Purchases: 1 · Releases: 0'
  );
});
