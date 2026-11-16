import { expect, type Page, test } from '@playwright/test';

async function open(page: Page, access = 'owner', lateDefinitions = false) {
  await page.route(/^https?:\/\/(?!127\.0\.0\.1:)/, (route) => route.abort());
  await page.goto(
    `/title.html?access=${access}${lateDefinitions ? '&lateDefinitions' : ''}`
  );
  await expect(page.getByTestId('section')).toHaveText('overview');
}

async function openMenu(page: Page, phone: boolean) {
  await page
    .getByRole('button', {
      name: phone ? 'Launch actions' : 'Project actions',
      exact: true,
    })
    .click();
  const menu = page.getByRole(phone ? 'dialog' : 'menu');
  await expect(menu).toBeVisible();
  return menu;
}

test('title uses standard actions with phone navigation outside the drawer', async ({
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
  if (!phone) {
    await page
      .getByRole('radiogroup', { name: 'Project sections' })
      .getByText('Tasks', { exact: true })
      .click();
    await expect(page.getByTestId('section')).toHaveText('tasks');
  }
  if (phone) {
    await expect(page.getByRole('button', { name: /Tasks$/ })).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: 'Share', exact: true })
    ).toBeVisible();
    const tasksMenu = await openMenu(page, true);
    await expect(
      tasksMenu.getByRole('radiogroup', { name: 'View' })
    ).toHaveCount(0);
  }
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

test('late property definitions and access changes update title actions', async ({
  page,
}, info) => {
  await open(page, 'owner', true);
  const phone = info.project.name === 'phone';
  const role = phone ? 'button' : 'menuitem';
  let menu = await openMenu(page, phone);
  await expect(
    menu.getByRole(role, { name: 'Set status', exact: true })
  ).toHaveCount(0);
  await expect(
    menu.getByRole(role, { name: 'Share', exact: true })
  ).toBeVisible();
  await menu.getByRole(role, { name: 'Share', exact: true }).click();
  await expect(menu).toBeHidden();
  await page.getByRole('button', { name: 'Load definitions' }).click();
  menu = await openMenu(page, phone);
  await expect(
    menu.getByRole(role, { name: 'Set status', exact: true })
  ).toBeVisible();
  await expect(
    menu.getByRole(role, { name: 'Set priority', exact: true })
  ).toBeVisible();
  await menu.getByRole(role, { name: 'Share', exact: true }).click();
  await expect(menu).toBeHidden();
  await page.getByRole('button', { name: 'Revoke edit access' }).click();
  menu = await openMenu(page, phone);
  await expect(
    menu.getByRole(role, { name: 'Set status', exact: true })
  ).toHaveCount(0);
  await expect(
    menu.getByRole(role, { name: 'Set priority', exact: true })
  ).toHaveCount(0);
});

test('open rename and delete dialogs recheck permission before writing', async ({
  page,
}, info) => {
  const phone = info.project.name === 'phone';
  const role = phone ? 'button' : 'menuitem';
  await open(page);
  let menu = await openMenu(page, phone);
  await menu.getByRole(role, { name: 'Rename', exact: true }).click();
  await page.getByRole('textbox', { name: 'Name' }).fill('Blocked rename');
  await page
    .getByTestId('revoke-project-access')
    .evaluate((button) =>
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    );
  await page.getByRole('button', { name: 'Save name' }).click();
  await expect(page.getByRole('alert')).toContainText(
    'Could not rename project'
  );
  await expect(page.getByTestId('name')).toHaveText('Launch');

  await open(page);
  menu = await openMenu(page, phone);
  await menu.getByRole(role, { name: 'Delete', exact: true }).click();
  await page
    .getByTestId('revoke-project-access')
    .evaluate((button) =>
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    );
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /Delete/ })
    .click();
  await expect(page.getByRole('alert')).toContainText('Only the project owner');
  await expect(page.getByTestId('deletes')).toHaveText('0');
});
test('phone header shows one page without a Tasks shortcut', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'phone');
  await open(page);
  await expect(page.getByRole('button', { name: /Tasks$/ })).toHaveCount(0);
  await expect(
    page.getByRole('radiogroup', { name: 'Project sections' })
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Share', exact: true })
  ).toBeVisible();
});

test('tablet keeps the section tabs rather than a Tasks island', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'phone');
  await page.setViewportSize({ width: 820, height: 900 });
  await open(page);
  await expect(
    page.getByRole('radiogroup', { name: 'Project sections' })
  ).toBeVisible();
  await expect(page.getByRole('button', { name: /Tasks$/ })).toHaveCount(0);
  await page
    .getByRole('radiogroup', { name: 'Project sections' })
    .getByText('Tasks', { exact: true })
    .click();
  await expect(page.getByTestId('section')).toHaveText('tasks');
});
test('long name keeps phone Share and Details within a 390px header', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'phone');
  await page.route(/^https?:\/\/(?!127\.0\.0\.1:)/, (route) => route.abort());
  await page.goto('/title.html?longName');
  const title = page.getByRole('button', {
    name: /An exceptionally long project title/,
  });
  const share = page.getByRole('button', { name: 'Share', exact: true });
  const details = page.getByRole('button', { name: 'Show details' });
  await expect(share).toBeVisible();
  await expect(details).toBeVisible();
  const [titleBox, shareBox, detailsBox] = await Promise.all([
    title.boundingBox(),
    share.boundingBox(),
    details.boundingBox(),
  ]);
  expect(titleBox).not.toBeNull();
  expect(shareBox).not.toBeNull();
  expect(detailsBox).not.toBeNull();
  expect(titleBox!.x + titleBox!.width).toBeLessThanOrEqual(shareBox!.x + 1);
  expect(shareBox!.x + shareBox!.width).toBeLessThanOrEqual(detailsBox!.x + 1);
  expect(detailsBox!.x + detailsBox!.width).toBeLessThanOrEqual(390);
});
