import { expect, type Locator, type Page, test } from '@playwright/test';
import { installBrowserHooks } from './browser-hooks';

installBrowserHooks('/?drag');

async function dragBlock(
  page: Page,
  source: Locator,
  target: Locator,
  edge: 'before' | 'after'
) {
  await source.hover();
  const handle = page.locator('.draggable-block-menu');
  await expect(handle).toHaveAttribute('draggable', 'true');
  const bounds = await target.boundingBox();
  if (!bounds) throw new Error('Expected drop target geometry');
  // Native mouse HTML5 drag; touch viewport profiles do not make this a touch drag.
  await handle.dragTo(target, {
    targetPosition: {
      x: bounds.width / 2,
      y: edge === 'before' ? 2 : bounds.height - 2,
    },
  });
}

test('mouse block drag moves a paragraph after its neighbor and supports undo redo', async ({
  page,
}) => {
  await page
    .getByRole('button', { name: 'Load drag blocks', exact: true })
    .click();
  const body = page.locator('#body');
  await dragBlock(
    page,
    body.getByText('Alpha block', { exact: true }),
    body.getByText('Charlie block', { exact: true }),
    'after'
  );
  await expect(body.locator(':scope > p')).toHaveText([
    'Bravo block',
    'Charlie block',
    'Alpha block',
  ]);
  await body.click();
  await page.keyboard.press('Control+z');
  await expect(body.locator(':scope > p')).toHaveText([
    'Alpha block',
    'Bravo block',
    'Charlie block',
  ]);
  await page.keyboard.press('Control+Shift+z');
  await expect(body.locator(':scope > p')).toHaveText([
    'Bravo block',
    'Charlie block',
    'Alpha block',
  ]);
});

test('mouse block drag inserts before the first block and restores saved JSON after reset', async ({
  page,
}) => {
  await page
    .getByRole('button', { name: 'Load drag blocks', exact: true })
    .click();
  const body = page.locator('#body');
  await dragBlock(
    page,
    body.getByText('Charlie block', { exact: true }),
    body.getByText('Alpha block', { exact: true }),
    'before'
  );
  await expect(body.locator(':scope > p')).toHaveText([
    'Charlie block',
    'Alpha block',
    'Bravo block',
  ]);
  await page.getByRole('button', { name: 'Save state', exact: true }).click();
  await page
    .getByRole('button', { name: 'Load drag blocks', exact: true })
    .click();
  await expect(body.locator(':scope > p')).toHaveText([
    'Alpha block',
    'Bravo block',
    'Charlie block',
  ]);
  await page
    .getByRole('button', { name: 'Reopen saved state', exact: true })
    .click();
  await expect(body.locator(':scope > p')).toHaveText([
    'Charlie block',
    'Alpha block',
    'Bravo block',
  ]);
});

test('mouse block drag onto itself leaves the document unchanged', async ({
  page,
}) => {
  await page
    .getByRole('button', { name: 'Load drag blocks', exact: true })
    .click();
  const body = page.locator('#body');
  await page.getByRole('button', { name: 'Save state', exact: true }).click();
  const before = await page.locator('#saved').textContent();
  await body.evaluate((root) => {
    root.setAttribute('data-native-drops', '0');
    // Observe before the production handler stops propagation. Do not inject
    // drag events or transfer data: this must arrive from the real handle.
    window.addEventListener(
      'drop',
      (event) => {
        if (event.target instanceof Node && root.contains(event.target)) {
          root.setAttribute(
            'data-native-drops',
            String(Number(root.getAttribute('data-native-drops')) + 1)
          );
          root.setAttribute(
            'data-native-drop-trusted',
            String(event.isTrusted)
          );
        }
      },
      true
    );
  });
  const source = body.getByText('Alpha block', { exact: true });
  await dragBlock(page, source, source, 'after');
  await expect(body).toHaveAttribute('data-native-drops', '1');
  await expect(body).toHaveAttribute('data-native-drop-trusted', 'true');
  await page.getByRole('button', { name: 'Save state', exact: true }).click();
  expect(await page.locator('#saved').textContent()).toBe(before);
});

test('mouse drag of the first list item moves the whole checklist', async ({
  page,
}) => {
  await page
    .getByRole('button', { name: 'Load drag list', exact: true })
    .click();
  const body = page.locator('#body');
  await dragBlock(
    page,
    body.getByText('First item', { exact: true }),
    body.getByText('Trailing block', { exact: true }),
    'after'
  );
  await expect(body.locator(':scope > :is(p, ul)')).toHaveCount(3);
  await expect(body.locator(':scope > p')).toHaveText([
    'Leading block',
    'Trailing block',
  ]);
  await expect(body.locator(':scope > :last-child')).toHaveJSProperty(
    'tagName',
    'UL'
  );
  await expect(body.locator(':scope > ul > li')).toHaveText([
    'First item',
    'Grouped item',
    'Nested child',
    'Last item',
  ]);
  await expect(
    body.getByRole('checkbox').filter({ hasText: 'Grouped item' })
  ).toBeChecked();
  await expect(body.getByText('Nested child', { exact: true })).toBeVisible();
});

test('mouse list reorder carries its nested wrapper and checked state', async ({
  page,
}) => {
  await page
    .getByRole('button', { name: 'Load drag list', exact: true })
    .click();
  const body = page.locator('#body');
  await dragBlock(
    page,
    body.getByText('Grouped item', { exact: true }),
    body.getByText('Last item', { exact: true }),
    'after'
  );
  const rows = body.locator(':scope > ul > li');
  await expect(rows).toHaveText([
    'First item',
    'Last item',
    'Grouped item',
    'Nested child',
  ]);
  await expect(
    body.getByRole('checkbox').filter({ hasText: 'Grouped item' })
  ).toBeChecked();
  await expect(rows.last().locator('ul > li')).toHaveText('Nested child');
});

test('mouse extraction wraps a grouped checklist item in a new checklist at root', async ({
  page,
}) => {
  await page
    .getByRole('button', { name: 'Load drag list', exact: true })
    .click();
  const body = page.locator('#body');
  await dragBlock(
    page,
    body.getByText('Grouped item', { exact: true }),
    body.getByText('Trailing block', { exact: true }),
    'after'
  );
  const lists = body.locator(':scope > ul');
  await expect(lists).toHaveCount(2);
  await expect(lists.nth(0).locator(':scope > li')).toHaveText([
    'First item',
    'Last item',
  ]);
  await expect(lists.nth(1).locator(':scope > li')).toHaveText([
    'Grouped item',
    'Nested child',
  ]);
  await expect(
    lists.nth(1).getByRole('checkbox').filter({ hasText: 'Grouped item' })
  ).toBeChecked();
  await expect(body.locator(':scope > :last-child')).toHaveJSProperty(
    'tagName',
    'UL'
  );
});

test('mouse block insertion splits a checklist after the targeted nested group', async ({
  page,
}) => {
  await page
    .getByRole('button', { name: 'Load drag list', exact: true })
    .click();
  const body = page.locator('#body');
  await dragBlock(
    page,
    body.getByText('Leading block', { exact: true }),
    body.getByText('Grouped item', { exact: true }),
    'after'
  );
  const lists = body.locator(':scope > ul');
  await expect(lists).toHaveCount(2);
  await expect(lists.nth(0).locator(':scope > li')).toHaveText([
    'First item',
    'Grouped item',
    'Nested child',
  ]);
  await expect(lists.nth(1).locator(':scope > li')).toHaveText(['Last item']);
  await expect(body.locator(':scope > :nth-child(2)')).toHaveText(
    'Leading block'
  );
  await expect(body.locator(':scope > :last-child')).toHaveText(
    'Trailing block'
  );
});

test('read-only removes the mouse drag handle and unlocking restores block movement', async ({
  page,
}) => {
  await page
    .getByRole('button', { name: 'Load drag blocks', exact: true })
    .click();
  const body = page.locator('#body');
  await page.getByRole('button', { name: 'Read only', exact: true }).click();
  await body.getByText('Alpha block', { exact: true }).hover();
  await expect(page.locator('.draggable-block-menu')).toHaveCount(0);
  await expect(body.locator(':scope > p')).toHaveText([
    'Alpha block',
    'Bravo block',
    'Charlie block',
  ]);
  await page.getByRole('button', { name: 'Editable', exact: true }).click();
  await dragBlock(
    page,
    body.getByText('Alpha block', { exact: true }),
    body.getByText('Charlie block', { exact: true }),
    'after'
  );
  await expect(body.locator(':scope > p')).toHaveText([
    'Bravo block',
    'Charlie block',
    'Alpha block',
  ]);
});
