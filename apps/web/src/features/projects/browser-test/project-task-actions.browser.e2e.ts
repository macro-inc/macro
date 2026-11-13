import { expect, type Page, test } from '@playwright/test';

async function open(page: Page, scenario = '') {
  await page.route('**/*', (route) => {
    if (new URL(route.request().url()).hostname === '127.0.0.1')
      return route.continue();
    return route.abort();
  });
  await page.routeWebSocket('**/*', (socket) => socket.close());
  await page.goto(`/?scenario=${scenario}`);
  await expect(page.getByTestId('creates')).toBeAttached();
}

test('Add task opens choices without creating and supports keyboard selection', async ({
  page,
}, info) => {
  await open(page);
  const add = page.getByRole('button', {
    name: info.project.name !== 'desktop' ? 'Task' : 'Add task',
    exact: true,
  });
  await add.click();
  await expect(page.getByTestId('creates')).toHaveText('0');
  if (info.project.name !== 'desktop') {
    await expect(
      page.getByRole('dialog', { name: 'Create new', exact: true })
    ).toBeVisible();
    await page.getByRole('button', { name: 'New task', exact: true }).click();
  } else {
    await page.getByRole('menuitem', { name: 'New task', exact: true }).focus();
    await page.keyboard.press('Enter');
  }
  await expect(page.getByTestId('creates')).toHaveText('1');
  await expect(page.getByTestId('assignments')).toBeEmpty();
});

test('Add task selects existing tasks and excludes linked tasks', async ({
  page,
}, info) => {
  await open(page);
  await page
    .getByRole('button', {
      name: info.project.name !== 'desktop' ? 'Task' : 'Add task',
      exact: true,
    })
    .click();
  await page
    .getByRole(info.project.name !== 'desktop' ? 'button' : 'menuitem', {
      name: 'Add existing tasks',
      exact: true,
    })
    .click();
  await expect(page.getByRole('checkbox', { name: 'linked' })).toBeDisabled();
  await page.getByRole('checkbox', { name: 'one' }).check();
  await page.getByRole('checkbox', { name: 'two' }).check();
  await page.screenshot({
    path: `/tmp/project-task-picker-${info.project.name}.png`,
  });
  await page.getByRole('button', { name: 'Add 2 tasks' }).click();
  await expect(page.getByTestId('assignments')).toHaveText('project: one,two');
  await expect(
    page.getByRole(info.project.name !== 'desktop' ? 'dialog' : 'menu')
  ).toHaveCount(0);
});

test('empty state uses the Add task menu and opens documentation in a new tab', async ({
  page,
}, info) => {
  await open(page, 'empty');
  await expect(
    page.getByRole('heading', { name: 'No tasks yet' })
  ).toBeVisible();
  await expect(
    page.getByText("Add tasks to plan and track this project's work.")
  ).toBeVisible();
  await page.getByRole('button', { name: 'Add task', exact: true }).click();
  await expect(page.getByTestId('creates')).toHaveText('0');
  await page
    .getByRole(info.project.name !== 'desktop' ? 'button' : 'menuitem', {
      name: 'New task',
      exact: true,
    })
    .click();
  await expect(page.getByTestId('creates')).toHaveText('1');
  await page
    .context()
    .route('https://docs.macro.com/product/projects', (route) =>
      route.fulfill({
        body: '<title>Projects documentation</title>',
        contentType: 'text/html',
      })
    );
  const popup = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Documentation' }).click();
  await expect(await popup).toHaveURL(
    'https://docs.macro.com/product/projects'
  );
  await page.screenshot({
    path: `/tmp/project-task-empty-${info.project.name}.png`,
  });
});

test('read-only empty state keeps documentation without task mutations', async ({
  page,
}) => {
  await open(page, 'readonly');
  await expect(
    page.getByRole('heading', { name: 'No tasks yet' })
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Add task', exact: true })
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Documentation' })
  ).toBeVisible();
});
