import { expect, type Page, test } from '@playwright/test';
import { installBrowserHooks, toggleChecklistMarker } from './browser-hooks';

installBrowserHooks('/?controls');

async function selectFilter(
  page: Page,
  hasTouch: boolean,
  group: string,
  option: string
) {
  const taskList = page
    .locator('#body')
    .locator('ul')
    .filter({ hasText: 'Open row!!' });
  // Kobalte hides the editor from the accessibility tree while its modal
  // menu is open; retain a DOM locator for open/close state assertions.
  const trigger = taskList.locator('button[aria-label="Filter tasks"]');
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  if (hasTouch) {
    // Current controls hide their pointer target after touch ends. Focus is a
    // precondition here: this exercises keyboard activation, not touch access.
    await trigger.focus();
    await page.keyboard.press('Space');
  } else {
    await taskList.hover();
    await trigger.click();
  }
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  if (hasTouch) {
    await expect(
      page.getByRole('menuitem', { name: 'Status', exact: true })
    ).toBeFocused();
  }
  const category = page.getByRole('menuitem', { name: group, exact: true });
  if (hasTouch) {
    await category.focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('menuitemcheckbox').first()).toBeFocused();
  } else await category.hover();
  const choice = page.getByRole('menuitemcheckbox', {
    name: option,
    exact: true,
  });
  if (hasTouch) {
    await choice.focus();
    await page.keyboard.press('Enter');
  } else await choice.click();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await expect(trigger).toBeFocused();
  return taskList;
}

test('checklist controls render progress for plain and task lists with filters only for tasks', async ({
  page,
}) => {
  await page
    .getByRole('button', { name: 'Load checklists', exact: true })
    .click();
  const body = page.getByRole('textbox', { name: 'Body', exact: true });
  const bars = body.locator('.mdtl-bar');
  await expect(bars).toHaveCount(2);
  await expect(bars.nth(0)).toHaveText('1/2');
  await expect(bars.nth(1)).toHaveText('1/2');
  await expect(
    bars.nth(0).getByRole('button', { name: 'Filter tasks', exact: true })
  ).toHaveCount(0);
  await expect(
    bars.nth(1).getByRole('button', { name: 'Filter tasks', exact: true })
  ).toHaveCount(1);
});

test('checklist status filters dim excluded rows and clear without changing progress', async ({
  page,
  hasTouch,
}) => {
  await page
    .getByRole('button', { name: 'Load checklists', exact: true })
    .click();
  const taskList = await selectFilter(page, hasTouch, 'Status', 'Done');
  await expect(
    taskList.locator('li').filter({ hasText: 'Open row!!' })
  ).toHaveClass(/mdtl-dim/);
  await expect(
    taskList.locator('li').filter({ hasText: 'Done row' })
  ).not.toHaveClass(/mdtl-dim/);
  await expect(taskList.locator('.mdtl-bar')).toContainText('1/2');
  // Kobalte hides the editor from the accessibility tree while its modal
  // menu is open; retain a DOM locator for open/close state assertions.
  const trigger = taskList.locator('button[aria-label="Filter tasks"]');
  if (hasTouch) {
    await trigger.focus();
    await page.keyboard.press('Space');
    await expect(
      page.getByRole('menuitem', { name: 'Status', exact: true })
    ).toBeFocused();
    await page.getByRole('menuitem', { name: /Clear/ }).focus();
    await page.keyboard.press('Enter');
  } else {
    await trigger.click();
    await page.getByRole('menuitem', { name: /Clear/ }).click();
  }
  await expect(taskList.locator('.mdtl-dim')).toHaveCount(0);
  await expect(taskList.locator('.mdtl-bar')).toHaveText('1/2');
  await page.keyboard.press('Escape');
});

test('checklist persisted filters restore dimming after fresh list replacement and JSON reopen', async ({
  page,
  hasTouch,
}) => {
  await page
    .getByRole('button', { name: 'Load checklists', exact: true })
    .click();
  const taskList = await selectFilter(page, hasTouch, 'Status', 'Done');
  await expect(taskList.locator('.mdtl-dim')).toHaveCount(1);
  await page.getByRole('button', { name: 'Save state', exact: true }).click();
  const saved = JSON.parse(
    (await page.locator('#saved').textContent()) ?? '{}'
  );
  expect(saved.state.root.children[2].$.taskListView.filters.status).toEqual([
    'done',
  ]);
  await page
    .getByRole('button', { name: 'Load checklists', exact: true })
    .click();
  await expect(taskList.locator('.mdtl-dim')).toHaveCount(0);
  await page
    .getByRole('button', { name: 'Reopen saved state', exact: true })
    .click();
  await expect(
    taskList.locator('li').filter({ hasText: 'Open row!!' })
  ).toHaveClass(/mdtl-dim/);
  await expect(
    taskList.locator('li').filter({ hasText: 'Done row' })
  ).not.toHaveClass(/mdtl-dim/);
  await expect(taskList.locator('.mdtl-bar')).toContainText('1/2');
});

test('checklist filter dimensions combine with AND while total progress stays unchanged', async ({
  page,
  hasTouch,
}) => {
  await page
    .getByRole('button', { name: 'Load checklists', exact: true })
    .click();
  const taskList = await selectFilter(page, hasTouch, 'Status', 'Done');
  await selectFilter(page, hasTouch, 'Priority', 'High');
  await expect(taskList.locator('.mdtl-dim')).toHaveCount(2);
  await expect(taskList.locator('.mdtl-bar')).toHaveText('1/22');
  await expect(
    taskList.locator('li').filter({ hasText: 'Open row!!' })
  ).toBeVisible();
  await expect(
    taskList.locator('li').filter({ hasText: 'Done row' })
  ).toBeVisible();
});

test('checklist progress follows native checkbox changes and rejects read-only toggles', async ({
  page,
  hasTouch,
}) => {
  await page
    .getByRole('button', { name: 'Load checklists', exact: true })
    .click();
  const body = page.getByRole('textbox', { name: 'Body', exact: true });
  const list = body.locator('ul').filter({ hasText: 'Plain completed' });
  const check = list.getByRole('checkbox').filter({ hasText: 'Plain open' });
  await page.getByRole('button', { name: 'Read only', exact: true }).click();
  await toggleChecklistMarker(page, check, hasTouch);
  await expect(check).not.toBeChecked();
  await expect(list.locator('.mdtl-bar')).toHaveText('1/2');
  await page.getByRole('button', { name: 'Editable', exact: true }).click();
  await toggleChecklistMarker(page, check, hasTouch);
  await expect(check).toBeChecked();
  await expect(list.locator('.mdtl-bar')).toHaveText('2/2');
});

test('checklist filter pointer target is available on hover and unavailable after touch ends', async ({
  page,
  hasTouch,
}) => {
  await page
    .getByRole('button', { name: 'Load checklists', exact: true })
    .click();
  const list = page
    .locator('#body')
    .locator('ul')
    .filter({ hasText: 'Open row!!' });
  if (hasTouch) await list.getByText('Open row!!', { exact: false }).tap();
  else await list.hover();
  const trigger = list.getByRole('button', {
    name: 'Filter tasks',
    exact: true,
  });
  await expect(trigger).toHaveCSS('pointer-events', hasTouch ? 'none' : 'auto');
  expect(
    await trigger.evaluate((button) => {
      const r = button.getBoundingClientRect();
      return button.contains(
        document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
      );
    })
  ).toBe(!hasTouch);
});
