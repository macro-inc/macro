import { expect, type Page, test } from '@playwright/test';

async function openMenu(page: Page, eligible = true) {
  await page.goto(`/?command-menu${eligible ? '&eligible' : ''}`);
  await page
    .getByRole('button', { name: 'Open Command K', exact: true })
    .click();
  const dialog = page.getByRole('dialog');
  await expect(
    dialog.getByPlaceholder('Search...', { exact: true })
  ).toBeFocused();
  return dialog;
}

test('Command K promotes while typing without dropping text, then submits edited fields with the composer shortcut', async ({
  page,
}) => {
  const dialog = await openMenu(page);
  const measure = (element: HTMLElement) => {
    const bounds = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
      x: bounds.x,
      textTop: bounds.y + Number.parseFloat(style.paddingTop),
      width: bounds.width,
      fontSize: style.fontSize,
      lineHeight: style.lineHeight,
      rowHeight: element
        .closest('[style*="grid-area"]')
        ?.getBoundingClientRect().height,
    };
  };
  const before = await dialog
    .getByPlaceholder('Search...', { exact: true })
    .evaluate(measure);
  const text = 'email John I will be late tomorrow';
  await page.keyboard.type(text, { delay: 40 });
  const input = dialog.getByRole('textbox', {
    name: 'Your input',
    exact: true,
  });
  await expect(input).toHaveText(text);
  await expect(input).toBeFocused();
  const after = await input.evaluate(measure);
  expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(after.textTop - before.textTop)).toBeLessThanOrEqual(1);
  expect(Math.abs(after.width - before.width)).toBeLessThanOrEqual(1);
  expect(after.fontSize).toBe(before.fontSize);
  expect(after.lineHeight).toBe(before.lineHeight);
  expect(after.rowHeight).toBeDefined();
  expect(after.rowHeight).toBe(before.rowHeight);
  await expect(
    dialog.getByText('Create or find something', { exact: true })
  ).toHaveCount(0);
  await expect(
    dialog.getByRole('button', { name: 'Send email', exact: true })
  ).toBeEnabled();
  const subject = dialog.getByRole('textbox', { name: 'Subject', exact: true });
  await subject.fill('My subject');
  await subject.press('Tab');
  await expect(dialog).toBeVisible();
  await input.click();
  await input.press('Enter');
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId('command-submission-count')).toHaveText('0');
  await expect(
    dialog.getByRole('button', { name: 'Send email', exact: true })
  ).toBeEnabled();
  await input.press('Control+Enter');
  await expect(dialog).not.toBeVisible();
  await expect(page.getByTestId('command-submission-count')).toHaveText('1');
  await expect(page.getByTestId('last-command-submission')).toContainText(
    'My subject'
  );
  await page
    .getByRole('button', { name: 'Open Command K', exact: true })
    .click();
  await expect(
    dialog.getByPlaceholder('Search...', { exact: true })
  ).toHaveValue('');
});

test('Command K keeps the composer for shorter edits, clears back to search, and dismisses with Escape', async ({
  page,
}) => {
  const dialog = await openMenu(page);
  await dialog
    .getByPlaceholder('Search...', { exact: true })
    .fill('dinner with julia tomorrow at 7pm');
  const input = dialog.getByRole('textbox', {
    name: 'Your input',
    exact: true,
  });
  await expect(input).toBeFocused();
  await input.fill('email John');
  await expect(input).toBeVisible();
  await expect(
    dialog.getByPlaceholder('Search...', { exact: true })
  ).toHaveCount(0);
  await input.fill('');
  const search = dialog.getByPlaceholder('Search...', { exact: true });
  await expect(search).toHaveValue('');
  await expect(search).toBeFocused();
  await search.fill('notification clicks do not work on mobile');
  await expect(input).toBeFocused();
  await input.press('Escape');
  await expect(dialog).not.toBeVisible();
});

test('Command K promotes a long single-word paste, preserves the insertion point, and reopens with a blank query', async ({
  page,
}) => {
  const dialog = await openMenu(page);
  const text = 'a'.repeat(60);
  const search = dialog.getByPlaceholder('Search...', { exact: true });
  await search.evaluate((input: HTMLTextAreaElement, value) => {
    input.value = value;
    input.setSelectionRange(10, 10);
    input.dispatchEvent(
      new InputEvent('input', { bubbles: true, inputType: 'insertText' })
    );
  }, text);
  const input = dialog.getByRole('textbox', {
    name: 'Your input',
    exact: true,
  });
  await expect(input).toBeFocused();
  await page.keyboard.type('X');
  await expect(input).toHaveText(`${'a'.repeat(10)}X${'a'.repeat(50)}`);
  await input.press('Escape');
  await page
    .getByRole('button', { name: 'Open Command K', exact: true })
    .click();
  await expect(
    dialog.getByPlaceholder('Search...', { exact: true })
  ).toHaveValue('');
});

test('Command K waits for composition to finish before promotion', async ({
  page,
}) => {
  const dialog = await openMenu(page);
  const search = dialog.getByPlaceholder('Search...', { exact: true });
  await search.evaluate((input: HTMLTextAreaElement) => {
    input.dispatchEvent(
      new CompositionEvent('compositionstart', { bubbles: true })
    );
    input.value = 'dinner with julia tomorrow at 7pm';
    input.dispatchEvent(
      new InputEvent('input', { bubbles: true, isComposing: true })
    );
  });
  await expect(search).toBeFocused();
  await expect(
    dialog.getByRole('textbox', { name: 'Your input', exact: true })
  ).toHaveCount(0);
  await search.dispatchEvent('compositionend');
  await expect(
    dialog.getByRole('textbox', { name: 'Your input', exact: true })
  ).toBeFocused();
});

test('Command K retains search behavior for users without Universal Input access', async ({
  page,
}) => {
  const dialog = await openMenu(page, false);
  const search = dialog.getByPlaceholder('Search...', { exact: true });
  await search.fill('how the notification system works on mobile');
  await expect(search).toBeFocused();
  await expect(
    dialog.getByRole('textbox', { name: 'Your input', exact: true })
  ).toHaveCount(0);
  await search.press('Escape');
  await expect(dialog).not.toBeVisible();
});

test('Command K composer uses the shared live search results and closes after opening one', async ({
  page,
}) => {
  const dialog = await openMenu(page);
  await dialog
    .getByPlaceholder('Search...', { exact: true })
    .fill('find how blowholes work in the ocean');
  const query = dialog.getByRole('textbox', {
    name: 'Search for',
    exact: true,
  });
  await query.fill('how blowholes work');
  const results = dialog.getByRole('listbox', {
    name: 'Search results',
    exact: true,
  });
  await expect(
    results.getByRole('option', { name: 'How Blowholes Work', exact: true })
  ).toBeVisible();
  await query.press('ArrowDown');
  await query.press('Enter');
  await expect(dialog).not.toBeVisible();
  await expect(page.getByTestId('opened-search-result')).toContainText(
    'search-document-2'
  );
  await expect(page.getByTestId('opened-search-result')).toContainText(
    'kommand-menu'
  );
});

test('the Macro logo hides for explicit newlines and wrapping, then returns for a single line', async ({
  page,
}) => {
  const dialog = await openMenu(page);
  await dialog
    .getByPlaceholder('Search...', { exact: true })
    .fill('Email Julia that I will be late');
  const input = dialog.getByRole('textbox', {
    name: 'Your input',
    exact: true,
  });
  const logo = dialog.getByTestId('command-input-logo');
  await expect(logo).toBeVisible();
  const originalLeft = (await input.boundingBox())!.x;
  await input.fill('Email Julia\nI will be late');
  await expect(logo).toBeHidden();
  expect((await input.boundingBox())!.x).toBe(originalLeft - 32);
  await input.fill('Email Julia that I will be late');
  await expect(logo).toBeVisible();
  await input.fill(
    'Email Julia that I will send the revised presentation after our meeting tomorrow'
  );
  await page.setViewportSize({ width: 520, height: 900 });
  await expect(logo).toBeHidden();
  await page.setViewportSize({ width: 1000, height: 1000 });
  await expect(logo).toBeVisible();
});

for (const eligible of [false, true]) {
  test(`Shift+Enter inserts a newline in normal search (Universal Input access: ${eligible})`, async ({
    page,
  }) => {
    const dialog = await openMenu(page, eligible);
    const search = dialog.getByPlaceholder('Search...', { exact: true });
    await search.fill('investor');
    await expect(
      dialog.getByRole('option', { name: 'Investor update', exact: true })
    ).toBeVisible();
    await search.press('End');
    await search.press('Shift+Enter');
    await expect(search).toHaveValue('investor\n');
    await expect(search).toBeFocused();
    await expect(dialog).toBeVisible();
    await expect(page.getByTestId('opened-search-result')).toHaveText('');
    await expect(dialog.getByTestId('command-input-logo')).toBeHidden();
    await page.keyboard.type('update');
    await expect(search).toHaveValue('investor\nupdate');
    await page.keyboard.down('Shift');
    await page.keyboard.down('Enter');
    await page.keyboard.up('Shift');
    await page.keyboard.up('Enter');
    await expect(search).toHaveValue('investor\nupdate\n');
    await expect(dialog).toBeVisible();
    await expect(page.getByTestId('opened-search-result')).toHaveText('');
  });
}

test('Shift+Enter keeps Universal Input search open while browsing a result', async ({
  page,
}) => {
  const dialog = await openMenu(page);
  await dialog
    .getByPlaceholder('Search...', { exact: true })
    .fill('find how blowholes work');
  const input = dialog.getByRole('textbox', {
    name: 'Your input',
    exact: true,
  });
  const results = dialog.getByRole('listbox', {
    name: 'Search results',
    exact: true,
  });
  await expect(
    results.getByRole('option', { name: 'How Blowholes Work', exact: true })
  ).toBeVisible();
  await input.press('ArrowDown');
  await input.press('Shift+Enter');
  await expect(input.locator('p')).toHaveCount(2);
  await expect(input).toBeFocused();
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId('opened-search-result')).toHaveText('');
  await page.keyboard.type('in the ocean');
  await expect(input.locator('p')).toHaveText([
    'find how blowholes work',
    'in the ocean',
  ]);
  await input.press('ArrowDown');
  await page.keyboard.down('Shift');
  await page.keyboard.down('Enter');
  await page.keyboard.up('Shift');
  await page.keyboard.up('Enter');
  await expect(input.locator('p')).toHaveCount(3);
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId('opened-search-result')).toHaveText('');
});

test('the type selector uses the shared dropdown and Escape leaves Command K open', async ({
  page,
}) => {
  const dialog = await openMenu(page);
  await dialog
    .getByPlaceholder('Search...', { exact: true })
    .fill('find how blowholes work');
  const type = dialog.getByLabel('Content type');
  await expect(type).toHaveText('Auto · Search');
  await type.click();
  const task = page.getByRole('option', { name: 'Task', exact: true });
  await expect(task).toBeVisible();
  await expect(task).toHaveClass(/rounded-lg/);
  await task.click();
  await expect(type).toHaveText('Task');
  await expect(
    dialog.getByRole('textbox', { name: 'Your input', exact: true })
  ).toHaveText('find how blowholes work');
  await type.click();
  await expect(
    page.getByRole('option', { name: 'Task', exact: true })
  ).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Escape');
  await expect(
    page.getByRole('option', { name: 'Task', exact: true })
  ).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await expect(type).toBeFocused();
  await type.click();
  await page.getByRole('option', { name: 'Auto', exact: true }).click();
  await expect(type).toHaveText('Auto · Search');
});

test('Escape closes the calendar date picker before the Command K composer', async ({
  page,
}) => {
  const dialog = await openMenu(page);
  await dialog
    .getByPlaceholder('Search...', { exact: true })
    .fill('Call John at 3pm tomorrow');
  const startDate = page.getByRole('button', {
    name: 'Edit event start date',
    exact: true,
  });
  await expect(startDate).toBeVisible();
  await startDate.click();
  await expect(page.getByRole('grid')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('grid')).not.toBeVisible();
  await expect(
    page.getByRole('textbox', { name: 'Your input', exact: true })
  ).toBeVisible();
});
