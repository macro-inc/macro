import { expect, type Page, test } from '@playwright/test';

async function open(page: Page, scenario = '') {
  await page.route('**/*', (route) => {
    if (new URL(route.request().url()).hostname === '127.0.0.1')
      return route.continue();
    return route.abort();
  });
  await page.routeWebSocket('**/*', (socket) => socket.close());
  await page.goto(`/?scenario=${scenario}`);
  await expect(page.getByTestId('creates')).toBeVisible();
}

test('desktop primary action creates without assigning', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'desktop');
  await open(page);
  await page.getByRole('button', { name: 'New task' }).click();
  await expect(page.getByTestId('creates')).toHaveText('1');
  await expect(page.getByTestId('assignments')).toBeEmpty();
  await page.screenshot({ path: '/tmp/project-task-desktop.png' });
});

test('desktop dropdown selects existing tasks and excludes linked tasks', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'desktop');
  await open(page);
  await page.getByRole('button', { name: 'More task actions' }).click();
  await page.getByRole('menuitem', { name: 'Add existing tasks' }).click();
  await expect(page.getByRole('checkbox', { name: 'linked' })).toBeDisabled();
  await page.getByRole('checkbox', { name: 'one' }).check();
  await page.getByRole('checkbox', { name: 'two' }).check();
  await page.screenshot({ path: '/tmp/project-task-dropdown.png' });
  await page.getByRole('button', { name: 'Add 2 tasks' }).click();
  await expect(page.getByTestId('assignments')).toHaveText('project: one,two');
  await expect(page.getByRole('menu')).toHaveCount(0);
});

test('empty state offers both actions and read-only state offers neither', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'desktop');
  await open(page, 'empty');
  await expect(page.getByText('No tasks yet')).toBeVisible();
  await page.getByRole('button', { name: 'New task' }).click();
  await expect(page.getByTestId('creates')).toHaveText('1');
  await page.getByRole('button', { name: 'Add existing tasks' }).click();
  await expect(page.getByRole('checkbox', { name: 'one' })).toBeVisible();
  await page.screenshot({ path: '/tmp/project-task-empty.png' });
  await open(page, 'readonly');
  await expect(page.getByText('No tasks yet')).toBeVisible();
  await expect(page.getByRole('button', { name: 'New task' })).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Add existing tasks' })
  ).toHaveCount(0);
});

test('phone floating create opens choices and existing picker', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'phone');
  await open(page);
  await page.getByRole('button', { name: 'Task' }).click();
  await page.getByRole('button', { name: 'Add existing' }).click();
  const drawer = page.getByRole('dialog', { name: 'Add project task' });
  await expect(drawer).toBeVisible();
  await drawer.getByRole('checkbox', { name: 'one' }).check();
  await page.screenshot({ path: '/tmp/project-task-phone.png' });
  await drawer.getByRole('button', { name: 'Add 1 task' }).click();
  await expect(page.getByTestId('assignments')).toHaveText('project: one');
  await page.getByRole('button', { name: 'Task' }).click();
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await expect(page.getByTestId('creates')).toHaveText('1');
});

test('phone empty state creates and opens the existing-task picker directly', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'phone');
  await open(page, 'empty');
  await page.getByRole('button', { name: 'New task' }).click();
  await expect(page.getByTestId('creates')).toHaveText('1');
  await page.getByRole('button', { name: 'Add existing' }).click();
  const drawer = page.getByRole('dialog', { name: 'Add project task' });
  await expect(drawer.getByRole('checkbox', { name: 'one' })).toBeVisible();
  await expect(drawer.getByRole('button', { name: 'New task' })).toHaveCount(0);
  await drawer.getByRole('button', { name: 'Cancel' }).click();
  await expect(drawer).toHaveCount(0);
});
