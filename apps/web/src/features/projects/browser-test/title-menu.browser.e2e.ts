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
  if (phone) {
    await page.getByRole('button', { name: /Tasks/ }).click();
  } else {
    await page
      .getByRole('radiogroup', { name: 'Project sections' })
      .getByText('Tasks', { exact: true })
      .click();
  }
  await expect(page.getByTestId('section')).toHaveText('tasks');
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
test('phone Tasks shortcut pushes history and caret and browser traverse it', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'phone');
  await open(page);
  const shortcut = page.getByRole('button', { name: /Tasks/ });
  const back = page.getByRole('button', { name: 'Go back' });
  await expect(shortcut).toBeVisible();
  await expect(back).toBeDisabled();
  await shortcut.click();
  await expect(page.getByTestId('section')).toHaveText('tasks');
  await expect(page).toHaveURL(/\/projects\/[^/]+\/tasks$/);
  await expect(shortcut).toHaveCount(0);
  await expect(back).toBeEnabled();
  await back.click();
  await expect(page.getByTestId('section')).toHaveText('overview');
  await shortcut.click();
  await expect(page.getByTestId('section')).toHaveText('tasks');
  await page.goBack();
  await expect(page.getByTestId('section')).toHaveText('overview');
  await page.goForward();
  await expect(page.getByTestId('section')).toHaveText('tasks');
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
test('long name keeps phone Tasks and Share within 390px header', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'phone');
  await page.route(/^https?:\/\/(?!127\.0\.0\.1:)/, (route) => route.abort());
  await page.goto('/title.html?longName');
  await expect(page.getByTestId('section')).toHaveText('overview');
  await expect(
    page.getByRole('button', { name: 'Share', exact: true })
  ).toHaveCount(0);
  const details = page.getByRole('button', { name: 'Show details' });
  await expect(details).toBeVisible();
  const row = page.getByTestId('header-row');
  const title = page.getByRole('button', {
    name: /An exceptionally long project title/,
  });
  const tasks = page.getByRole('button', { name: /Tasks$/ });
  await expect(tasks).toBeVisible();
  const boxes = await Promise.all(
    [row, title, tasks, details].map((item) => item.boundingBox())
  );
  for (const box of boxes) {
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  }
  expect(boxes[1]!.x + boxes[1]!.width).toBeLessThanOrEqual(boxes[2]!.x + 1);
  expect(boxes[2]!.x + boxes[2]!.width).toBeLessThanOrEqual(boxes[3]!.x + 1);
  await page.screenshot({
    path: '/tmp/project-title-long-phone.png',
    animations: 'disabled',
  });
  await tasks.click();
  await expect(page.getByTestId('section')).toHaveText('tasks');
  const share = page.getByRole('button', { name: 'Share', exact: true });
  await expect(share).toBeVisible();
  const [taskTitle, taskShare, taskDetails] = await Promise.all([
    title.boundingBox(),
    share.boundingBox(),
    details.boundingBox(),
  ]);
  expect(taskTitle).not.toBeNull();
  expect(taskShare).not.toBeNull();
  expect(taskTitle!.x + taskTitle!.width).toBeLessThanOrEqual(taskShare!.x + 1);
  expect(taskShare!.x + taskShare!.width).toBeLessThanOrEqual(390);
  expect(taskDetails).not.toBeNull();
  expect(taskShare!.x + taskShare!.width).toBeLessThanOrEqual(
    taskDetails!.x + 1
  );
  expect(taskDetails!.x + taskDetails!.width).toBeLessThanOrEqual(390);
  await page.screenshot({
    path: '/tmp/project-title-tasks-phone.png',
    animations: 'disabled',
  });
});
