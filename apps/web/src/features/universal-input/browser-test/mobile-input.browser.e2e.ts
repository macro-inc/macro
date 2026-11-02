import { expect, test } from '@playwright/test';

test('keeps the mobile editor focused as forms appear above it and Enter adds a line', async ({
  page,
}) => {
  await page.goto('/?mobile-search&eligible&legacy');
  await page
    .getByRole('button', { name: 'Open mobile search', exact: true })
    .tap();
  const input = page.getByRole('textbox', {
    name: 'Search or create',
    exact: true,
  });
  const original = await input.elementHandle();
  await input.fill('notification clicks are broken');
  const title = page.getByRole('textbox', { name: 'Title', exact: true });
  await expect(title).toBeVisible();
  await expect(input).toBeFocused();
  await expect(input).toHaveAttribute('enterkeyhint', 'enter');
  await input.press('End');
  await input.press('Enter');
  await input.pressSequentially('priority urgent');
  await expect(input).toHaveValue(
    'notification clicks are broken\npriority urgent'
  );
  expect(
    await original?.evaluate((element) => element === document.activeElement)
  ).toBe(true);
  await title.fill('Fix mobile notification routing');
  await input.fill(
    'notification clicks are broken\npriority urgent\nInclude Android\nInclude iOS\nInclude tablets\nCheck navigation\nAdd regression coverage'
  );
  await expect(title).toHaveText('Fix mobile notification routing');
  const description = page.getByRole('textbox', {
    name: 'Description',
    exact: true,
  });
  await description.fill(
    'Check notification routing on every device.\n'.repeat(40)
  );
  await page.evaluate(() =>
    document.documentElement.style.setProperty('--dvh', '5px')
  );
  await page.evaluate(() => new Promise(requestAnimationFrame));
  const fields = page.locator('[data-float-region="accessory"]');
  const fieldBounds = await fields.boundingBox();
  const inputBounds = await input.boundingBox();
  expect(fieldBounds!.y).toBeGreaterThanOrEqual(0);
  expect(fieldBounds!.y + fieldBounds!.height).toBeLessThanOrEqual(
    inputBounds!.y
  );
  expect(inputBounds!.y + inputBounds!.height).toBeLessThanOrEqual(500);
  const create = page.getByRole('button', { name: 'Create task', exact: true });
  await expect(create).toBeEnabled();
  await expect(create).toBeInViewport({ ratio: 1 });
  const card = page.locator('.universal-input-fields');
  const cardBounds = await card.boundingBox();
  const selector = page.getByLabel('Content type', { exact: true });
  const selectorBounds = await selector.boundingBox();
  const createBounds = await create.boundingBox();
  const content = page.getByRole('region', { name: 'Suggested fields' });
  const scrollTop = await content.evaluate((element) => element.scrollTop);
  await content.hover();
  await page.mouse.wheel(0, scrollTop ? -1000 : 1000);
  await expect(content).not.toHaveJSProperty('scrollTop', scrollTop);
  expect((await card.boundingBox())!.y).toBeCloseTo(cardBounds!.y);
  expect((await selector.boundingBox())!.y).toBeCloseTo(selectorBounds!.y);
  expect((await create.boundingBox())!.y).toBeCloseTo(createBounds!.y);
  await expect(selector).toBeInViewport({ ratio: 1 });
  await create.tap();
  await expect(page.getByTestId('command-submission-count')).toHaveText('1');
  await expect(page.getByTestId('last-command-submission')).toContainText(
    'Fix mobile notification routing'
  );
  await expect(input).toHaveValue('');
  await expect(input).toBeFocused();
  expect(await original?.evaluate((element) => element.isConnected)).toBe(true);
});

test('replaces the normal results and filter tabs with the card until the input is cleared', async ({
  page,
}) => {
  const failures: string[] = [];
  page.on('pageerror', (error) => failures.push(error.message));
  await page.goto('/?mobile-search&eligible&legacy');
  await page
    .getByRole('button', { name: 'Open mobile search', exact: true })
    .tap();
  const input = page.getByRole('textbox', {
    name: 'Search or create',
    exact: true,
  });
  const filters = page.locator('header[aria-label="Search filters"]');
  const results = page.getByRole('region', {
    name: 'Search results',
    exact: true,
  });
  await input.fill('John');
  await expect(filters).toBeVisible();
  await expect(results).toBeVisible();
  const original = await input.elementHandle();
  await input.fill('notification clicks are broken');
  await expect(
    page.getByRole('button', { name: 'Create task', exact: true })
  ).toBeEnabled();
  await expect(filters).not.toBeVisible();
  await expect(results).not.toBeVisible();
  await input.fill('short');
  await expect(filters).not.toBeVisible();
  await expect(results).not.toBeVisible();
  expect(
    await original?.evaluate((element) => element === document.activeElement)
  ).toBe(true);
  await input.fill('');
  await expect(filters).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Create task', exact: true })
  ).not.toBeVisible();
  await expect(input).toBeFocused();
  expect(failures).toEqual([]);
});

test('keeps mobile email unsent until Send and submits the visible draft once', async ({
  page,
}) => {
  await page.goto('/?mobile-search&eligible&legacy');
  await page
    .getByRole('button', { name: 'Open mobile search', exact: true })
    .tap();
  const input = page.getByRole('textbox', {
    name: 'Search or create',
    exact: true,
  });
  await input.fill('Email John that I’ll be late');
  const send = page.getByRole('button', { name: 'Send email', exact: true });
  await expect(send).toBeEnabled();
  await expect(page.getByTestId('command-submission-count')).toHaveText('0');
  await expect(
    page.getByRole('button', { name: 'Save as draft', exact: true })
  ).toBeEnabled();
  await expect(page.getByTestId('submit-shortcut')).not.toBeVisible();
  await send.scrollIntoViewIfNeeded();
  await send.tap();
  await expect(page.getByTestId('command-submission-count')).toHaveText('1');
  await expect(page.getByTestId('last-command-submission')).toContainText(
    'I’ll be late'
  );
  await expect(input).toHaveValue('');
  await expect(input).toBeFocused();
});

test('waits for IME composition before predicting from the mobile editor', async ({
  page,
}) => {
  await page.goto('/?mobile-search&eligible&legacy');
  await page
    .getByRole('button', { name: 'Open mobile search', exact: true })
    .tap();
  const input = page.getByRole('textbox', {
    name: 'Search or create',
    exact: true,
  });
  await input.evaluate((element) => {
    const textarea = element as HTMLTextAreaElement;
    textarea.dispatchEvent(
      new CompositionEvent('compositionstart', { bubbles: true })
    );
    textarea.value = 'notification clicks are broken';
    textarea.dispatchEvent(
      new InputEvent('input', { bubbles: true, isComposing: true })
    );
  });
  await expect(page.getByTestId('mobile-query')).toHaveText('');
  await expect(
    page.getByRole('button', { name: 'Create task', exact: true })
  ).not.toBeVisible();
  await input.dispatchEvent('compositionend');
  await expect(page.getByTestId('mobile-query')).toHaveText(
    'notification clicks are broken'
  );
  await expect(
    page.getByRole('button', { name: 'Create task', exact: true })
  ).toBeEnabled();
  await expect(input).toBeFocused();
});

test('uses live global search filters on mobile and opens a filtered hit directly', async ({
  page,
}) => {
  await page.goto('/?mobile-search&eligible&legacy');
  await page
    .getByRole('button', { name: 'Open mobile search', exact: true })
    .tap();
  const input = page.getByRole('textbox', {
    name: 'Search or create',
    exact: true,
  });
  await input.fill('search messages from julia in #sales about budget');
  const filters = page.getByLabel('Search filters');
  await expect(filters.getByText('Channels', { exact: true })).toBeVisible();
  await expect(filters.getByText('Julia Jones', { exact: true })).toBeVisible();
  const results = page.getByRole('listbox', {
    name: 'Search results',
    exact: true,
  });
  await expect(results.getByRole('option')).toHaveCount(1);
  await expect(results).toContainText('Julia shared the budget');
  await expect(page.getByTestId('global-search-requests')).toContainText(
    '"sender_ids":["macro|julia@macro.com"]'
  );
  await expect(page.getByTestId('global-search-requests')).toContainText(
    '"channel_ids":["sales-channel"]'
  );
  await expect(
    page.getByRole('button', { name: 'Search', exact: true })
  ).not.toBeVisible();
  await results
    .getByRole('option')
    .getByText('Unknown Filename', { exact: true })
    .tap();
  await expect(page.getByTestId('opened-search-result')).toContainText(
    'sales-channel'
  );
  await expect(page.getByTestId('mobile-query')).toHaveText('');
  await expect(input).not.toBeVisible();
});

test('keeps ordinary mobile search when the rollout flag is off and closes cleanly', async ({
  page,
}) => {
  await page.goto('/?mobile-search&eligible&no-universal');
  await page
    .getByRole('button', { name: 'Open mobile search', exact: true })
    .tap();
  const input = page.getByRole('textbox', { name: 'Search', exact: true });
  await input.fill('notification clicks are broken');
  await input.press('End');
  await input.press('Enter');
  await input.pressSequentially('priority urgent');
  await expect(input).toHaveValue(
    'notification clicks are broken\npriority urgent'
  );
  await expect(input).toBeFocused();
  await expect(
    page.getByRole('button', { name: 'Create task', exact: true })
  ).not.toBeVisible();
  await page.getByRole('button', { name: 'Close search', exact: true }).tap();
  await expect(input).not.toBeVisible();
  await expect(page.getByTestId('mobile-query')).toHaveText('');
});
