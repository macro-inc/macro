import { expect, type Page, test } from '@playwright/test';

async function open(page: Page, access = 'owner') {
  await page.route('**/*', (route) => {
    if (new URL(route.request().url()).hostname === '127.0.0.1')
      return route.continue();
    return route.abort();
  });
  await page.routeWebSocket('**/*', (socket) => socket.close());
  await page.goto(`/title.html?access=${access}`);
  await expect(page.getByTestId('section')).toHaveText('overview');
}

async function openMenu(page: Page, phone: boolean) {
  await page
    .getByRole('button', {
      name: phone ? 'Launch actions' : 'Project actions',
      exact: true,
    })
    .click();
  return page.getByRole(phone ? 'dialog' : 'menu');
}

test('title uses standard actions without moving phone tabs into the drawer', async ({
  page,
}, info) => {
  await open(page);
  const phone = info.project.name === 'phone';
  const menu = await openMenu(page, phone);
  const role = phone ? 'button' : 'menuitem';
  await expect(
    menu.getByRole(role, { name: 'Rename', exact: true })
  ).toBeVisible();
  await expect(
    menu.getByRole(role, { name: 'Delete', exact: true })
  ).toBeVisible();
  await expect(menu.getByRole('radiogroup', { name: 'View' })).toHaveCount(0);
  await expect(
    menu.getByRole(role, { name: 'Delete', exact: true })
  ).toBeInViewport();
  await page.screenshot({
    path: `/tmp/project-title-${info.project.name}.png`,
    animations: 'disabled',
  });
  await menu.getByRole(role, { name: 'Share', exact: true }).click();
  await expect(page.getByTestId('shares')).toHaveText('1');
  await expect(menu).toBeHidden();
  await page
    .getByRole('radiogroup', { name: 'Project sections' })
    .getByText('Tasks', { exact: true })
    .click();
  await expect(page.getByTestId('section')).toHaveText('tasks');
});

test('read-only title keeps share without rename or delete', async ({
  page,
}, info) => {
  await open(page, 'view');
  const phone = info.project.name === 'phone';
  const menu = await openMenu(page, phone);
  const role = phone ? 'button' : 'menuitem';
  await expect(
    menu.getByRole(role, { name: 'Share', exact: true })
  ).toBeVisible();
  await expect(
    menu.getByRole(role, { name: 'Rename', exact: true })
  ).toHaveCount(0);
  await expect(
    menu.getByRole(role, { name: 'Delete', exact: true })
  ).toHaveCount(0);
});

test('editable title opens the real rename dialog and saves a new name', async ({
  page,
}, info) => {
  await open(page);
  const phone = info.project.name === 'phone';
  const menu = await openMenu(page, phone);
  await menu
    .getByRole(phone ? 'button' : 'menuitem', { name: 'Rename', exact: true })
    .click();
  await expect(page.getByText('Rename project')).toBeVisible();
  await page.getByRole('textbox', { name: 'Name' }).fill('Updated launch');
  await page.getByRole('button', { name: 'Save name' }).click();
  await expect(page.getByTestId('name')).toHaveText('Updated launch');
});
