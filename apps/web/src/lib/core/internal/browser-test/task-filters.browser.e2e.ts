import { expect, test } from '@playwright/test';

test('Tasks people filters page lazily and keep semantic Me, fixed self and unknown selections', async ({
  page,
}, info) => {
  const phone = info.project.name === 'phone';
  await page.goto('/?task-filters');
  await expect(page.getByTestId('task-requests')).toHaveText('0');
  await page
    .getByRole('button', {
      name: phone ? 'Open task filters' : 'Filter tasks',
      exact: true,
    })
    .click();
  await expect(page.getByTestId('task-requests')).toHaveText('0');
  await page
    .getByRole(phone ? 'button' : 'menuitem', { name: /^Assignee/ })
    .click();
  const role = phone ? 'checkbox' : 'option';
  const input = page.getByPlaceholder('Search assignees...');
  await expect(
    page.getByRole(role, { name: /Selected Person/ }).first()
  ).toBeVisible();
  await expect(
    page.getByRole(role, { name: /unavailable-person/ }).first()
  ).toBeVisible();
  await expect(
    page.getByRole(role, { name: /Viewer \(me\)/ }).first()
  ).toBeVisible();
  const me = page.getByRole(role, { name: 'Me', exact: true });
  if (phone) await me.click();
  else await me.locator('[data-multiselect-checkbox]').click();
  await expect(page.getByTestId('task-facets')).toContainText('@viewer');
  await expect(page.getByTestId('task-lookup')).not.toContainText('@viewer');
  if (!phone)
    await page.getByRole('listbox').evaluate((node) => {
      node.scrollTop = node.scrollHeight;
    });
  await page
    .getByRole(phone ? 'button' : 'option', {
      name: 'Next options',
      exact: true,
    })
    .click();
  await expect(
    page.getByRole(role, { name: /Person 50/ }).first()
  ).toBeInViewport();
  await input.fill('zxq');
  const found = page.getByRole(role, { name: 'Broader match', exact: true });
  await expect(found).toBeVisible();
  if (phone) await found.click();
  else await found.locator('[data-multiselect-checkbox]').click();
  await expect(page.getByTestId('task-facets')).toContainText(
    'macro|match@example.com'
  );
  await expect(page.getByTestId('task-facets')).toContainText(
    'unavailable-person'
  );
  if (!phone) {
    await found.hover();
    await found
      .getByRole('button', { name: 'Select only Broader match' })
      .click();
    await expect(page.getByTestId('task-facets')).not.toContainText(
      'unavailable-person'
    );
    await expect(page.getByTestId('task-facets')).not.toContainText('@viewer');
  }
  await expect(page.getByTestId('task-facets')).toContainText('in-progress');
});

for (const label of [
  'Late Person',
  'Family, Given',
  '@viewer',
  'viewer@example.com',
]) {
  test(`Task planner resolves ${label} without a personal prompt catalog`, async ({
    page,
  }, info) => {
    test.skip(
      info.project.name === 'phone',
      'AI filter input is desktop-only; mobile retains manual filters'
    );
    await page.goto('/?task-filters');
    await page
      .getByRole('button', { name: 'Filter tasks', exact: true })
      .click();
    const input = page.getByRole('textbox', { name: 'Filter with AI' });
    await input.fill(label);
    await input.press('Enter');
    const id =
      label === 'Late Person'
        ? 'macro|late@example.com'
        : label === 'Family, Given'
          ? 'macro|comma@example.com'
          : label === '@viewer'
            ? '@viewer'
            : 'macro|viewer@example.com';
    await expect(page.getByTestId('task-facets')).toHaveText(
      JSON.stringify({ status: ['completed'], assignees: [id] })
    );
    await expect(page.getByTestId('task-requests')).toHaveText('0');
    await expect(
      page.getByTestId('task-completion-requests')
    ).not.toContainText('Selected Person');
    await expect(
      page.getByTestId('task-completion-requests')
    ).not.toContainText('macro|person0');
    if (label.includes('Person') || label.includes(','))
      await expect(page.getByTestId('task-reference-requests')).toContainText(
        'after-empty-budget'
      );
    else
      await expect(page.getByTestId('task-reference-requests')).toHaveText(
        '[]'
      );
  });
}
for (const label of ['Ambiguous', 'target@example.com']) {
  test(`Task planner does not drop an unresolved ${label} constraint`, async ({
    page,
  }, info) => {
    test.skip(info.project.name === 'phone', 'No mobile AI control');
    await page.goto('/?task-filters');
    await page
      .getByRole('button', { name: 'Filter tasks', exact: true })
      .click();
    const input = page.getByRole('textbox', { name: 'Filter with AI' });
    await input.fill(label);
    await input.press('Enter');
    await expect(
      page.getByText(/A person is unknown, ambiguous, or unavailable/)
    ).toBeVisible();
    await expect(page.getByTestId('task-facets')).toContainText('in-progress');
    await expect(page.getByTestId('task-facets')).toContainText(
      'unavailable-person'
    );
    await expect(page.getByTestId('task-facets')).not.toContainText(
      'completed'
    );
    await expect(page.getByTestId('task-facets')).not.toContainText(
      'alias@example.com'
    );
  });
}
test('Task planner keeps incomplete offline evidence unresolved and succeeds on retry', async ({
  page,
  context,
}, info) => {
  test.skip(info.project.name === 'phone', 'No mobile AI control');
  await page.goto('/?task-filters');
  await page.getByRole('button', { name: 'Filter tasks', exact: true }).click();
  const input = page.getByRole('textbox', { name: 'Filter with AI' });
  await context.setOffline(true);
  await input.fill('Late Person');
  await input.press('Enter');
  await expect(
    page.getByText(/A person is unknown, ambiguous, or unavailable/)
  ).toBeVisible();
  await expect(page.getByTestId('task-facets')).toContainText('in-progress');
  await context.setOffline(false);
  await input.press('Enter');
  await expect(page.getByTestId('task-facets')).toHaveText(
    JSON.stringify({
      status: ['completed'],
      assignees: ['macro|late@example.com'],
    })
  );
});

for (const change of ['Manual priority', 'Navigate away', 'Replace login']) {
  test(`Task planner discards a delayed reply after ${change}`, async ({
    page,
  }, info) => {
    test.skip(info.project.name === 'phone', 'No mobile AI control');
    await page.goto('/?task-filters');
    await page.getByRole('button', { name: 'Hold model reply' }).click();
    await page
      .getByRole('button', { name: 'Filter tasks', exact: true })
      .click();
    const input = page.getByRole('textbox', { name: 'Filter with AI' });
    await input.fill('Late Person');
    await input.press('Enter');
    await expect(page.getByTestId('task-completion-pending')).toHaveText(
      'true'
    );
    await input.press('Escape');
    await page.getByRole('button', { name: change, exact: true }).click();
    await page.getByRole('button', { name: 'Release model reply' }).click();
    await expect(page.getByTestId('task-completion-pending')).toHaveText(
      'false'
    );
    await expect(page.getByTestId('task-facets')).toContainText('in-progress');
    await expect(page.getByTestId('task-facets')).not.toContainText(
      'completed'
    );
    await expect(page.getByTestId('task-reference-requests')).toHaveText('[]');
  });
}

test('Task list drawer offers Sort only while not searching', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'phone', 'Desktop uses the header controls');
  await page.goto('/?task-filters');
  const drawer = page.getByRole('dialog', { name: 'Task list controls' });
  const open = page.getByRole('button', { name: 'Open task filters' });
  await open.click();
  await expect(drawer.getByRole('radiogroup', { name: 'Sort' })).toBeVisible();

  await page.reload();
  await page.getByRole('button', { name: 'Search tasks' }).click();
  await open.click();
  await expect(drawer.getByRole('radiogroup', { name: 'Group' })).toBeVisible();
  await expect(drawer.getByRole('radiogroup', { name: 'Sort' })).toHaveCount(0);
  await expect(drawer.getByText(/search order/i)).toHaveCount(0);
});

test('Task list header offers no column sort while searching', async ({
  page,
}, info) => {
  test.skip(info.project.name === 'phone', 'Phones have no column header');
  await page.goto('/?task-filters');
  const header = page.getByRole('grid', { name: 'Tasks' }).getByRole('row');
  const sort = page.getByTestId('task-sort');
  await header.getByRole('button', { name: 'Due date' }).click();
  await expect(sort).toHaveText(
    '[{"id":"due_date_earliest","reversed":false}]'
  );

  await page.getByRole('button', { name: 'Search tasks' }).click();
  await expect(header.getByRole('button')).toHaveCount(0);
  const arrows = (name: string) =>
    header.getByRole('columnheader', { name }).locator('svg:visible');
  await expect(arrows('Updated')).toHaveCount(1);
  await expect(arrows('Due date')).toHaveCount(0);
  await header.getByText('Due date').click();
  await header.getByText('Updated').click();
  await expect(sort).toHaveText(
    '[{"id":"due_date_earliest","reversed":false}]'
  );

  await page.getByRole('button', { name: 'Clear search' }).click();
  await expect(header.getByRole('button')).toHaveText(['Due date', 'Updated']);
  await expect(sort).toHaveText(
    '[{"id":"due_date_earliest","reversed":false}]'
  );
});
