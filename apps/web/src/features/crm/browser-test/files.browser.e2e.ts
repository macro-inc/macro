import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  test.setTimeout(120_000);
  await page.routeWebSocket('**', (socket) => socket.close());
  await page.route('https://**', (route) => route.abort());
  await page.route('**/__macro_dev/**', (route) => route.abort());
  await page.goto('/src/features/crm/browser-test/files.html', {
    waitUntil: 'domcontentloaded',
  });
  await page.getByRole('button', { name: 'Set up file types' }).click();
});

test('the same source file keeps its type on both records and surfaces', async ({
  page,
}) => {
  const select = page.getByRole('button', {
    name: 'File type for Shared contract',
  });
  await select.click();
  await page.getByRole('option', { name: 'Contract', exact: true }).click();
  await expect(
    page.getByRole('region', { name: 'Contract', exact: true })
  ).toContainText('Shared contract');
  await expect(
    page.getByRole('button', { name: 'File type for Read-only proposal' })
  ).toBeDisabled();
  await page.getByRole('button', { name: 'Switch record' }).click();
  await expect(select).toHaveText('Contract');
  await page.getByRole('button', { name: 'Switch surface' }).click();
  await expect(select).toHaveText('Contract');
  await page.getByText('Shared contract', { exact: true }).click();
  await expect(page.getByLabel('Opened file')).toHaveText('shared');
  await page.screenshot({ path: '/tmp/macro-3927-files-desktop.png' });
  await page.getByRole('button', { name: 'Simulate unavailable type' }).click();
  await expect(select).toHaveText('Type unavailable');
  await expect(select).toBeDisabled();
});

test('team labels update existing groups and removal leaves files unclassified', async ({
  page,
}) => {
  await page
    .getByRole('button', { name: 'File type for Shared contract' })
    .click();
  await page.getByRole('option', { name: 'Contract', exact: true }).click();
  await page.getByRole('button', { name: 'Manage types' }).click();
  const dialog = page.getByRole('dialog');
  await dialog
    .getByRole('textbox', { name: 'Rename Contract' })
    .fill('Agreement');
  await dialog
    .getByRole('button', { name: 'Save', exact: true })
    .first()
    .click();
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(
    page.getByRole('region', { name: 'Agreement', exact: true })
  ).toContainText('Shared contract');
  await page.getByRole('button', { name: 'Manage types' }).click();
  await dialog
    .getByRole('button', { name: 'Remove', exact: true })
    .first()
    .click();
  await dialog.getByRole('button', { name: 'Remove type' }).click();
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(
    page.getByRole('region', { name: 'Unclassified', exact: true })
  ).toContainText('Shared contract');
});

test('group disclosure keeps focus and option identity through refresh and rename', async ({
  page,
}) => {
  await page
    .getByRole('button', { name: 'File type for Shared contract' })
    .click();
  await page.getByRole('option', { name: 'Contract', exact: true }).click();
  const header = page.getByRole('button', { name: /^Contract/ });
  const rows = page.getByRole('region', { name: 'Contract', exact: true });
  const contentId = await header.getAttribute('aria-controls');
  if (!contentId) throw new Error('Disclosure must identify its rows');
  await header.focus();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Shift+Tab');
  await expect(header).toBeFocused();
  expect(
    await header.evaluate((button) => {
      const style = getComputedStyle(button);
      return (
        style.outlineStyle !== 'none' &&
        Number.parseFloat(style.outlineWidth) >= 2
      );
    })
  ).toBe(true);
  await header.press('Enter');
  await expect(header).toHaveAttribute('aria-expanded', 'false');
  await expect(header).toBeFocused();
  await expect(rows.getByText('Shared contract', { exact: true })).toHaveCount(
    0
  );
  await header.press('Space');
  await expect(header).toHaveAttribute('aria-expanded', 'true');
  await expect(rows).toContainText('Shared contract');
  await header.press('ArrowLeft');
  await header.press('ArrowLeft');
  await expect(header).toHaveAttribute('aria-expanded', 'false');
  await header.press('ArrowRight');
  await expect(header).toHaveAttribute('aria-expanded', 'true');
  await header.press('ArrowLeft');
  // Refresh the fixture source without moving focus, like a background poll.
  await page
    .getByRole('button', { name: 'Refresh files' })
    .evaluate((button) => {
      if (!(button instanceof HTMLButtonElement))
        throw new Error('Refresh control must be a button');
      button.click();
    });
  await expect(header).toHaveAttribute('aria-expanded', 'false');
  await expect(header).toBeFocused();
  await expect(header).toHaveAttribute('aria-controls', contentId);

  await page.getByRole('button', { name: 'Manage types' }).click();
  const dialog = page.getByRole('dialog');
  await dialog
    .getByRole('textbox', { name: 'Rename Contract' })
    .fill('Agreement');
  await dialog
    .getByRole('button', { name: 'Save', exact: true })
    .first()
    .click();
  await dialog.getByRole('button', { name: 'Done' }).click();
  const renamed = page.getByRole('button', { name: /^Agreement/ });
  await expect(renamed).toHaveAttribute('aria-expanded', 'false');
  await expect(renamed).toHaveAttribute('aria-controls', contentId);
  await page.getByRole('button', { name: 'Switch record' }).click();
  await expect(renamed).toHaveAttribute('aria-expanded', 'true');
  await renamed.click();
  await page.getByRole('button', { name: 'Switch session' }).click();
  await expect(renamed).toHaveAttribute('aria-expanded', 'true');
});

test('collapsed groups retain explicit paging and retry without draining hidden pages', async ({
  page,
}) => {
  await page
    .getByRole('button', { name: 'File type for Shared contract' })
    .click();
  await page.getByRole('option', { name: 'Contract', exact: true }).click();
  const contract = page.getByRole('button', { name: /^Contract/ });
  await contract.click();
  // One group remains expanded while every next-page row belongs to Contract.
  await page.getByRole('button', { name: 'Enable more files' }).click();
  const more = page.getByRole('button', { name: 'More files', exact: true });
  await expect(more).toBeVisible();
  await expect(page.getByLabel('Loaded pages')).toHaveText('0');
  await more.click();
  await expect(page.getByLabel('Loaded pages')).toHaveText('1');
  await expect(contract).toContainText('2');
  await expect(page.getByText('Paged contract 1', { exact: true })).toHaveCount(
    0
  );
  await page.getByRole('button', { name: /^Unclassified/ }).click();
  await page.getByRole('button', { name: 'Fail next page' }).click();
  await more.click();
  await expect(page.getByText('Couldn’t load more files.')).toBeVisible();
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByLabel('Loaded pages')).toHaveText('2');
  await expect(more).toBeVisible();
  await expect(contract).toHaveAttribute('aria-expanded', 'false');
  await contract.click();
  await expect(
    page.getByText('Paged contract 1', { exact: true })
  ).toBeVisible();
  await expect(
    page.getByText('Paged contract 2', { exact: true })
  ).toBeVisible();
  await expect(page.getByLabel('Loaded pages')).toHaveText('2');
});

test('unknown type reads keep source files accessible without classifying them as unavailable', async ({
  page,
}) => {
  for (const state of [
    'catalog-loading',
    'values-loading',
    'no-team',
    'catalog-error',
  ]) {
    await page.getByRole('button', { name: `Simulate ${state}` }).click();
    await expect(
      page.getByText('Type unavailable', { exact: true })
    ).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: 'File type for Shared contract' })
    ).toHaveCount(0);
    await expect(page.getByText('Loading file types…')).toHaveCount(
      state.endsWith('loading') ? 1 : 0
    );
    await page.getByText('Shared contract', { exact: true }).click();
    await expect(page.getByLabel('Opened file')).toHaveText('shared');
  }
  await page
    .getByRole('button', { name: 'Simulate ready', exact: true })
    .click();
  await expect(
    page.getByRole('region', { name: 'Unclassified', exact: true })
  ).toContainText('Shared contract');
});

test.describe('phone', () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  test('type groups collapse by touch and keep long labels within the phone', async ({
    page,
  }) => {
    const header = page.getByRole('button', { name: /^Unclassified/ });
    const box = await header.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
    await header.tap();
    await expect(header).toHaveAttribute('aria-expanded', 'false');
    await expect(
      page.getByRole('button', { name: 'File type for Shared contract' })
    ).toHaveCount(0);
    await header.tap();
    await page
      .getByRole('button', { name: 'File type for Shared contract' })
      .tap();
    await page.getByRole('option', { name: 'Contract', exact: true }).tap();
    await page.getByRole('button', { name: 'Manage types' }).tap();
    const dialog = page.getByRole('dialog');
    const name =
      'Contract with an intentionally long team-defined business type';
    await dialog.getByRole('textbox', { name: 'Rename Contract' }).fill(name);
    await dialog
      .getByRole('button', { name: 'Save', exact: true })
      .first()
      .tap();
    await dialog.getByRole('button', { name: 'Done' }).tap();
    const renamed = page.getByRole('button', { name: new RegExp(`^${name}`) });
    await renamed.tap();
    await expect(renamed).toHaveAttribute('aria-expanded', 'false');
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth
      )
    ).toBe(true);
    await renamed.tap();
    await expect(
      page.getByRole('button', { name: 'File type for Shared contract' })
    ).toBeVisible();
  });
  test('mobile creation retries without duplicates and attaching preserves its type', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: 'Fail next attachment' }).click();
    await page.getByRole('button', { name: 'Add file', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByText('New note', { exact: true }).click();
    await dialog
      .getByRole('textbox', { name: 'File name' })
      .fill('October invoice');
    await dialog.getByRole('button', { name: /^File type / }).click();
    const invoice = page.getByRole('option', { name: 'Invoice', exact: true });
    expect(
      await invoice.evaluate((option) =>
        Boolean(option.closest('[data-corvu-drawer-content]'))
      )
    ).toBe(true);
    await invoice.tap();
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Create and attach' }).click();
    await expect(dialog.getByRole('alert')).toContainText(
      'The file was created'
    );
    await dialog.getByRole('button', { name: 'Retry', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expect(page.getByLabel('Created files')).toHaveText('1');
    await page.getByRole('button', { name: 'Switch record' }).click();
    await page.getByRole('button', { name: 'Add file', exact: true }).click();
    await dialog
      .getByRole('button', { name: 'October invoice', exact: true })
      .click();
    await dialog
      .getByRole('button', { name: 'Attach file', exact: true })
      .click();
    await expect(
      page.getByRole('region', { name: 'Invoice', exact: true })
    ).toContainText('October invoice');
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth
      )
    ).toBe(true);
    await page.screenshot({ path: '/tmp/macro-3927-files-mobile.png' });
  });
});
