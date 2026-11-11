import { expect, test } from '@playwright/test';

for (const trigger of ['Assignees', 'Assignee sheet']) {
  test(`${trigger} navigates, selects, searches and dismisses from the keyboard`, async ({
    page,
  }) => {
    await page.goto('/assignee-keyboard.html');
    await page.getByRole('button', { name: trigger, exact: true }).click();
    const search = page.getByPlaceholder('Add assignees...');
    await expect(search).toBeFocused();
    const highlighted = page.locator('[data-entity-index].bg-hover');
    await expect(highlighted).toContainText('Viewer');

    await search.press('ArrowDown');
    await expect(highlighted).toContainText('Alpha');
    await search.press('ArrowDown');
    await expect(highlighted).toContainText('Beta');
    await search.press('ArrowUp');
    await expect(highlighted).toContainText('Alpha');
    await expect(search).toBeFocused();

    await search.press('Enter');
    await expect(page.getByTestId('selected')).toHaveText(
      '["macro|alpha@example.com"]'
    );
    await expect(search).toBeFocused();
    await search.fill('Beta');
    await expect(highlighted).toContainText('Beta');
    await search.press('Enter');
    await expect(page.getByTestId('selected')).toHaveText(
      '["macro|alpha@example.com","macro|beta@example.com"]'
    );
    await search.fill('no matches');
    await expect(page.locator('[data-entity-index]')).toHaveCount(0);
    await search.press('Escape');
    await expect(search).toBeHidden();
  });
}

test('single-person entity picker selects the highlighted row and closes', async ({
  page,
}) => {
  await page.goto('/assignee-keyboard.html?single');
  await page.getByRole('button', { name: 'Assignees', exact: true }).click();
  const search = page.getByPlaceholder('Add assignees...');
  await expect(search).toBeFocused();
  await search.press('ArrowUp');
  await expect(page.locator('[data-entity-index].bg-hover')).toContainText(
    'Beta'
  );
  await search.press('Enter');
  await expect(search).toBeHidden();
  await expect(page.getByTestId('selected')).toHaveText(
    '["macro|beta@example.com"]'
  );
});

test('another field does not navigate or select in the entity picker', async ({
  page,
}) => {
  await page.goto('/assignee-keyboard.html');
  await page.getByRole('button', { name: 'Assignees', exact: true }).click();
  await expect(page.getByPlaceholder('Add assignees...')).toBeFocused();
  const field = page.getByLabel('Another field');
  await field.fill('text');
  await field.press('ArrowDown');
  await field.press('Enter');
  await expect(field).toBeFocused();
  await expect(field).toHaveValue('text');
  await expect(page.getByTestId('selected')).toHaveText('[]');
  await expect(page.locator('[data-entity-index].bg-hover')).toContainText(
    'Viewer'
  );
});

test('ordinary dropdown retains native arrow navigation', async ({ page }) => {
  await page.goto('/assignee-keyboard.html');
  await page.getByRole('button', { name: 'Working menu' }).click();
  const highlighted = page.locator('[role="menuitem"][data-highlighted]');
  await page.getByRole('menuitem', { name: 'Alpha', exact: true }).focus();
  await page.keyboard.press('ArrowDown');
  await expect(highlighted).toHaveText('Beta');
  await page.keyboard.press('ArrowDown');
  await expect(highlighted).toHaveText('Gamma');
  await page.keyboard.press('ArrowUp');
  await expect(highlighted).toHaveText('Beta');
  await page.keyboard.press('Escape');
  await expect(
    page.getByRole('button', { name: 'Working menu' })
  ).toBeFocused();
});

for (const mode of ['task-filters', 'soup-filters=tasks']) {
  test(`${mode} Assignee filter retains search and keyboard selection`, async ({
    page,
  }, info) => {
    const phone = info.project.name === 'phone';
    const tasks = mode === 'task-filters';
    await page.goto(`/?${mode}`);
    let trigger = tasks ? 'Filter tasks' : 'Filter';
    if (phone) trigger = tasks ? 'Open task filters' : 'Open filters';
    await page.getByRole('button', { name: trigger, exact: true }).click();
    if (phone) await page.getByRole('button', { name: /^Assignee/ }).click();
    else
      await page
        .getByRole('menuitem', { name: 'Assignee', exact: true })
        .click();
    const search = page.getByPlaceholder('Search assignees...');
    await search.fill('Codex');
    if (phone) {
      // Phone facets are checkbox sections, not combobox menus.
      const option = page.getByRole('checkbox', { name: 'Codex', exact: true });
      await option.focus();
      await option.press('Enter');
      await expect(option).toBeChecked();
      await search.focus();
      await search.press('Escape');
      await expect(search).toBeHidden();
    } else {
      await search.press('ArrowDown');
      const option = page.getByRole('option', { name: 'Codex', exact: true });
      await expect(option).toHaveAttribute('data-highlighted', '');
      await search.press('ArrowUp');
      await expect(option).toHaveAttribute('data-highlighted', '');
      await expect(search).toBeFocused();
      await search.press('Enter');
      await expect(search).toBeHidden();
    }
    await expect(
      page.getByTestId(tasks ? 'task-facets' : 'assignees')
    ).toContainText('bot|');
  });
}
