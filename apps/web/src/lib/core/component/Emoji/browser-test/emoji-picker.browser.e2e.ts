import { expect, type Page, test } from '@playwright/test';

const fixture = '/src/lib/core/component/Emoji/browser-test/emoji-picker.html';

async function openPicker(page: Page) {
  await page.goto(fixture);
  await page.getByRole('button', { name: 'React' }).click();
  const picker = page.getByRole('listbox', { name: 'Emoji Selector' });
  await expect(picker.getByRole('option').first()).toBeVisible({
    timeout: 30_000,
  });
  return picker;
}

test('opens with emojis on screen and renders only the rows in view', async ({
  page,
}) => {
  const picker = await openPicker(page);

  await expect(picker.getByText('Smileys & Emotion')).toBeVisible();
  await expect(picker.getByRole('option', { name: '😀' })).toBeVisible();
  // The catalog has about 1,900 emojis; a virtual list mounts a few rows.
  expect(await picker.getByRole('option').count()).toBeLessThan(300);
});

test('a cell is a sixth of the row and a wider cell cannot grow the glyph', async ({
  page,
}) => {
  const picker = await openPicker(page);

  const measured = await picker.evaluate((list) => {
    const option = list.querySelector('[role="option"]') as HTMLElement;
    const row = option.parentElement as HTMLElement;
    const glyph = option.querySelector('p') as HTMLElement;
    const width = (el: HTMLElement) => el.getBoundingClientRect().width;
    const fontSize = () => Number.parseFloat(getComputedStyle(glyph).fontSize);

    const laidOut = { row: width(row), cell: width(option), glyph: fontSize() };

    // Stand in for the layout behind the report, where a row resolved to one
    // full-width cell. Sizing the glyph off the cell turns that into one emoji
    // filling the picker, so the glyph must not follow the cell.
    row.style.setProperty('grid-template-columns', 'minmax(0, 1fr)');
    const collapsed = { cell: width(option), glyph: fontSize() };

    return { laidOut, collapsed };
  });

  expect(measured.laidOut.cell).toBeCloseTo(measured.laidOut.row / 6, 0);
  expect(measured.collapsed.cell).toBeGreaterThan(measured.laidOut.cell * 3);
  expect(measured.collapsed.glyph).toBeCloseTo(measured.laidOut.glyph, 1);
});

test('scrolling reaches the last group', async ({ page }) => {
  const picker = await openPicker(page);
  const zimbabwe = picker.getByRole('option', { name: '🇿🇼' });

  // Rows are measured as they mount, so the end moves until it settles.
  await expect(async () => {
    await picker.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await expect(zimbabwe).toBeVisible({ timeout: 500 });
  }).toPass();
});

test('search shows matches and a click picks one', async ({ page }) => {
  const picker = await openPicker(page);

  await page.getByRole('searchbox', { name: 'Search emojis' }).fill('rocket');
  await expect(picker.getByText('Search Results')).toBeVisible();
  await picker.getByRole('option', { name: '🚀' }).first().click();

  await expect(page.getByTestId('picked')).toHaveText('🚀');
});

test('arrow keys scroll the selection into view and Enter picks it', async ({
  page,
}) => {
  const picker = await openPicker(page);

  await page.keyboard.press('ArrowUp');
  const selected = picker.locator('[aria-selected="true"]');
  await expect(selected).toBeVisible();
  const last = await selected.getAttribute('title');
  await page.keyboard.press('Enter');

  await expect(page.getByTestId('picked')).not.toHaveText('');
  expect(last).toBeTruthy();
});
