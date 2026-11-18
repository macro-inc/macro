import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, type Locator, type Page, test } from '@playwright/test';
import { installBrowserHooks } from '../drag-browser-test/browser-hooks';

installBrowserHooks('/?table-actions&table-controls&drag');

async function load(page: Page) {
  await page
    .getByRole('button', { name: 'Load table controls', exact: true })
    .click();
  await expect(page.locator('#body td')).toHaveCount(9);
}

async function hover(
  page: Page,
  cell: Locator,
  edge: 'bottom' | 'right' | 'top' | 'left' | 'corner'
) {
  const box = await cell.boundingBox();
  if (!box) throw new Error('Expected real table cell geometry');
  const x =
    edge === 'left' || edge === 'corner'
      ? box.x + 2
      : edge === 'right'
        ? box.x + box.width - 2
        : box.x + box.width / 2;
  const y =
    edge === 'top' || edge === 'corner'
      ? box.y + 2
      : edge === 'bottom'
        ? box.y + box.height - 2
        : box.y + box.height / 2;
  await page.mouse.move(x, y);
}

async function insert(page: Page, axis: 'row' | 'column') {
  const button = page.getByRole('button', {
    name: `Insert ${axis}`,
    exact: true,
  });
  await expect(button).toBeVisible();
  const box = await button.boundingBox();
  if (!box) throw new Error('Expected real insert button');
  // Use the exposed edge in both arms. Native resize is a separate capability;
  // the original resize-strip center hit assertion remains in its owner cohort.
  const position =
    axis === 'row'
      ? { x: box.width / 2, y: 2 }
      : { x: box.width - 2, y: box.height / 2 };
  expect(
    await button.evaluate((element, position) => {
      const box = element.getBoundingClientRect();
      const hit = document.elementFromPoint(
        box.left + position.x,
        box.top + position.y
      );
      return !!hit && element.contains(hit);
    }, position)
  ).toBe(true);
  await button.click({ position });
}

test('row insertion uses the hovered border and its real first-cell typing caret', async ({
  page,
}) => {
  await load(page);
  await hover(page, page.locator('#body td').nth(0), 'bottom');
  await insert(page, 'row');
  await expect(page.locator('#body tr')).toHaveCount(4);
  await expect(page.locator('#body tr').nth(1).locator('td')).toHaveText([
    '',
    '',
    '',
  ]);
  await page.keyboard.type('Inserted row');
  await expect(
    page.locator('#body tr').nth(1).locator('td').first()
  ).toHaveText('Inserted row');
  await expect(page.locator('#body tr').nth(2).locator('td')).toHaveText([
    'Cell 2:1',
    'Cell 2:2',
    'Cell 2:3',
  ]);
});

test('column insertion preserves the existing cells', async ({ page }) => {
  await load(page);
  await hover(page, page.locator('#body td').nth(0), 'right');
  await insert(page, 'column');
  await expect(page.locator('#body td')).toHaveCount(12);
  await expect(page.locator('#body tr').first().locator('td')).toHaveText([
    'Cell 1:1',
    '',
    'Cell 1:2',
    'Cell 1:3',
  ]);
  await expect(page.locator('#body tr').last().locator('td')).toHaveText([
    'Cell 3:1',
    '',
    'Cell 3:2',
    'Cell 3:3',
  ]);
});

test('row delete removes only the hovered row', async ({ page }) => {
  await load(page);
  await hover(page, page.locator('#body td').nth(3), 'left');
  await page.getByRole('button', { name: 'Delete row', exact: true }).click();
  await expect(page.locator('#body tr')).toHaveCount(2);
  await expect(page.locator('#body td')).toHaveText([
    'Cell 1:1',
    'Cell 1:2',
    'Cell 1:3',
    'Cell 3:1',
    'Cell 3:2',
    'Cell 3:3',
  ]);
});

test('column delete preserves the other columns', async ({ page }) => {
  await load(page);
  await hover(page, page.locator('#body td').nth(1), 'top');
  await page
    .getByRole('button', { name: 'Delete column', exact: true })
    .click();
  await expect(page.locator('#body td')).toHaveText([
    'Cell 1:1',
    'Cell 1:3',
    'Cell 2:1',
    'Cell 2:3',
    'Cell 3:1',
    'Cell 3:3',
  ]);
});

test('corner table delete removes the hovered table', async ({ page }) => {
  await load(page);
  await hover(page, page.locator('#body td').first(), 'corner');
  await page.getByRole('button', { name: 'Delete table', exact: true }).click();
  await expect(page.locator('#body table')).toHaveCount(0);
});

test('read-only retires hover buttons and unlocking restores insertion', async ({
  page,
}) => {
  await load(page);
  await hover(page, page.locator('#body td').first(), 'bottom');
  await expect(
    page.getByRole('button', { name: 'Insert row', exact: true })
  ).toBeVisible();
  await page.getByRole('button', { name: 'Read only', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Insert row', exact: true })
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Editable', exact: true }).click();
  await hover(page, page.locator('#body td').first(), 'bottom');
  await insert(page, 'row');
  await expect(page.locator('#body tr')).toHaveCount(4);
});

test('capture the actual Source table input', async ({ page }) => {
  test.skip(process.env.TABLE_ENGINE === 'native', 'Source input capture only');
  await load(page);
  await page.getByRole('button', { name: 'Save state', exact: true }).click();
  const saved = JSON.parse(await page.locator('#saved').innerText());
  const output = process.env.TABLE_SOURCE_INPUTS;
  if (!output) throw new Error('Source input capture directory required');
  await mkdir(output, { recursive: true });
  await writeFile(
    resolve(output, 'table.json'),
    JSON.stringify(saved.state) + '\n'
  );
});
