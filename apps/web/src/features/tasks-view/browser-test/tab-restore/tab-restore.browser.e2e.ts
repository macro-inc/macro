import { expect, type Page, test } from '@playwright/test';

async function statusFilter(page: Page, phone: boolean, label: string) {
  await page
    .getByRole('button', {
      name: phone ? 'Open task filters' : 'Filter tasks',
      exact: true,
    })
    .click();
  if (phone) {
    await page.getByRole('button', { name: 'Clear all', exact: true }).click();
    await page.getByRole('checkbox', { name: label, exact: true }).click();
    await page
      .getByRole('button', { name: 'Close filters', exact: true })
      .click();
  } else {
    await page
      .getByRole('menuitem', { name: 'Clear filters', exact: true })
      .click();
    await page
      .getByRole('button', { name: 'Filter tasks', exact: true })
      .click();
    await page.getByRole('menuitem', { name: 'Status', exact: true }).click();
    await page
      .getByRole('menuitemcheckbox', { name: label, exact: true })
      .click();
    await page.mouse.move(0, 0);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await expect(
      page.getByRole('menu', { name: 'Filter tasks', exact: true })
    ).toHaveCount(0);
    // Move keyboard focus off the filter trigger so its tooltip cannot cover
    // the next fixture action after the menu has closed.
    await page.keyboard.press('Tab');
  }
}

test('each Tasks tab restores its own status after switching and resuming the view', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const phone = info.project.name === 'phone';
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'Tasks', exact: true })
  ).toBeVisible();
  await statusFilter(page, phone, 'In progress');
  await expect(page.getByTestId('facets')).toHaveText(
    '{"status":["in-progress"]}'
  );
  await page.getByRole('button', { name: 'All tasks', exact: true }).click();
  await statusFilter(page, phone, 'Completed');
  await expect(page.getByTestId('facets')).toHaveText(
    '{"status":["completed"]}'
  );

  for (let index = 0; index < 2; index++) {
    await page.getByRole('button', { name: 'My tasks', exact: true }).click();
    await expect(page.getByTestId('facets')).toHaveText(
      '{"status":["in-progress"]}'
    );
    await expect(page.getByRole('list', { name: 'Task results' })).toHaveText(
      'Progress task'
    );
    await page.getByRole('button', { name: 'All tasks', exact: true }).click();
    await expect(page.getByTestId('facets')).toHaveText(
      '{"status":["completed"]}'
    );
    await expect(page.getByRole('list', { name: 'Task results' })).toHaveText(
      'Completed task'
    );
  }

  await page.getByRole('button', { name: 'Leave Tasks', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Tasks', exact: true })
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Resume Tasks', exact: true }).click();
  await expect(page.getByTestId('facets')).toHaveText(
    '{"status":["completed"]}'
  );
  await page.getByRole('button', { name: 'My tasks', exact: true }).click();
  await expect(page.getByTestId('facets')).toHaveText(
    '{"status":["in-progress"]}'
  );
  await page.screenshot({
    path: info.outputPath('tab-restore.png'),
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test('saved-view drafts do not overwrite a built-in tab or survive returning to the saved view', async ({
  page,
}, info) => {
  const phone = info.project.name === 'phone';
  await page.goto('/');
  await statusFilter(page, phone, 'In progress');
  await page
    .getByRole('button', { name: 'Open saved view', exact: true })
    .click();
  await expect(page.getByTestId('facets')).toHaveText(
    '{"status":["in-review"]}'
  );
  await statusFilter(page, phone, 'Completed');
  await page.getByRole('button', { name: 'My tasks', exact: true }).click();
  await expect(page.getByTestId('facets')).toHaveText(
    '{"status":["in-progress"]}'
  );
  await page
    .getByRole('button', { name: 'Open saved view', exact: true })
    .click();
  await expect(page.getByTestId('facets')).toHaveText(
    '{"status":["in-review"]}'
  );
});

test('account changes clear tab snapshots and replace the previous tab URL', async ({
  page,
}, info) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'All tasks', exact: true }).click();
  await statusFilter(page, info.project.name === 'phone', 'Completed');
  await page
    .getByRole('button', { name: 'Switch account', exact: true })
    .click();
  await expect(page.getByTestId('tab')).toHaveText('my-tasks');
  await expect(page.getByTestId('facets')).toHaveText(
    '{"status":["in-progress","in-review","not-started"]}'
  );
  await page.getByRole('button', { name: 'All tasks', exact: true }).click();
  await expect(page.getByTestId('facets')).toHaveText(
    '{"status":["in-progress","in-review","not-started"]}'
  );
});
