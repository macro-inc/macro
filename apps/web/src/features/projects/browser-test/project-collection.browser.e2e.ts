import { expect, type Page, test } from '@playwright/test';

async function open(page: Page) {
  await page.route('https://**/*', (route) => route.abort());
  await page.goto('/?scenario=collection');
  await expect(page.getByRole('grid', { name: 'Projects' })).toBeVisible();
}

test('narrow desktop collection filters projects', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop');
  await page.setViewportSize({ width: 700, height: 800 });
  await open(page);
  await expect(page.getByRole('row', { name: /Alpha launch/ })).toBeVisible();
  await expect(page.getByRole('row', { name: /Beta review/ })).toBeVisible();
  await page.screenshot({ path: '/tmp/project-collection-narrow.png' });
  await page.getByRole('button', { name: 'Filter projects' }).click();
  await expect(
    page.getByRole('menuitem', { name: 'Status', exact: true })
  ).toBeVisible();
  await page.screenshot({ path: '/tmp/project-collection-filter.png' });
});

test('phone collection changes filters, grouping and project scope', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'phone');
  await open(page);
  await expect(page.getByRole('row', { name: /Alpha launch/ })).toBeVisible();
  await page.screenshot({ path: '/tmp/project-collection-phone.png' });
  await page.getByRole('button', { name: 'Open project filters' }).click();
  const drawer = page.getByRole('dialog', { name: 'Project list controls' });
  await expect(drawer).toBeVisible();
  await drawer.getByRole('radio', { name: 'None', exact: true }).click();
  await expect(page.getByTestId('settings')).toContainText('"groupBy":"none"');
  await drawer.getByRole('radio', { name: 'Open', exact: true }).click();
  await page.screenshot({ path: '/tmp/project-collection-phone-filters.png' });
  await drawer
    .getByRole('button', { name: 'Close filters', exact: true })
    .click();
  await expect(page.getByRole('row', { name: /Beta review/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'All projects', exact: true }).click();
  await page
    .getByRole('button', { name: 'Created by me', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Created by me', exact: true })
  ).toBeVisible();
});

test('saved project views support create, rename, duplicate, delete and unsupported definitions', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'desktop');
  await open(page);
  await page.getByRole('button', { name: 'Create view', exact: true }).click();
  await page.getByRole('button', { name: 'Save view', exact: true }).click();
  const save = page.getByRole('dialog', { name: 'Save view' });
  await save.getByRole('textbox', { name: 'Name' }).fill('Launch watch');
  await save.getByRole('button', { name: 'Save view', exact: true }).click();
  await expect(save).toBeHidden();
  await expect(page.getByTestId('selected')).not.toBeEmpty();
  const more = page.getByRole('button', {
    name: 'Actions for Launch watch',
    exact: true,
  });
  const size = await more.boundingBox();
  expect(size).not.toBeNull();
  expect(size!.width).toBeCloseTo(size!.height, 0);
  await page.getByRole('button', { name: 'Launch watch', exact: true }).hover();
  await page
    .getByRole('button', { name: 'Actions for Launch watch', exact: true })
    .click();
  await page.getByRole('menuitem', { name: 'Rename', exact: true }).click();
  const edit = page.getByRole('dialog', { name: 'Edit “Launch watch”' });
  await edit.getByRole('textbox', { name: 'Name' }).fill('Launch renamed');
  await edit.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Launch renamed', exact: true })
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Launch renamed', exact: true })
    .hover();
  await page
    .getByRole('button', { name: 'Actions for Launch renamed', exact: true })
    .click();
  await page.getByRole('menuitem', { name: 'Duplicate', exact: true }).click();
  const duplicate = page.getByRole('dialog', { name: 'Duplicate saved view' });
  await expect(duplicate.getByRole('textbox', { name: 'Name' })).toHaveValue(
    'Launch renamed (copy)'
  );
  await duplicate
    .getByRole('button', { name: 'Duplicate', exact: true })
    .click();
  await expect(duplicate).toBeHidden();
  await page
    .getByRole('button', { name: 'Launch renamed (copy)', exact: true })
    .hover();
  await page
    .getByRole('button', {
      name: 'Actions for Launch renamed (copy)',
      exact: true,
    })
    .click();
  await page.getByRole('menuitem', { name: 'Delete', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Delete “Launch renamed (copy)”?' })
    .getByRole('button', { name: 'Delete view', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Launch renamed (copy)', exact: true })
  ).toHaveCount(0);
  await page
    .getByRole('button', { name: 'Launch renamed', exact: true })
    .click();
  await expect(page.getByRole('row', { name: /Alpha launch/ })).toBeVisible();
  await page.screenshot({ path: '/tmp/project-saved-created.png' });
  await page
    .getByRole('button', { name: 'Seed unsupported view', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Future definition', exact: true })
    .click();
  await expect(page.getByRole('alert')).toContainText('unsupported settings');
  await expect(page.getByRole('row', { name: /Alpha launch/ })).toHaveCount(0);
});

test('phone project picker creates and reopens a saved view', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'phone');
  await open(page);
  await page.getByRole('button', { name: 'All projects', exact: true }).click();
  const views = page.getByRole('dialog', { name: 'Projects' });
  await expect(
    views.getByRole('button', { name: 'All projects' })
  ).toHaveAttribute('aria-current', 'page');
  await views.getByRole('button', { name: 'All projects' }).click();
  await expect(views).toBeHidden();
  await page.getByRole('button', { name: 'All projects', exact: true }).click();
  await views.getByRole('button', { name: 'New view' }).click();
  await page.getByRole('button', { name: 'Save view', exact: true }).click();
  const save = page.getByRole('dialog', { name: 'Save view' });
  await save.getByRole('textbox', { name: 'Name' }).fill('Phone projects');
  await save.getByRole('button', { name: 'Save view', exact: true }).click();
  await expect(save).toBeHidden();
  await page
    .getByRole('button', { name: 'Phone projects', exact: true })
    .click();
  await views.getByRole('button', { name: 'My projects' }).click();
  await page.getByRole('button', { name: 'My projects', exact: true }).click();
  await views
    .getByRole('button', { name: 'Phone projects', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Phone projects', exact: true })
  ).toBeVisible();
  await page.screenshot({ path: '/tmp/project-saved-phone.png' });
});

test('empty projects offer creation and documentation at every width', async ({
  page,
}, info) => {
  await page.route('https://**/*', (route) => route.abort());
  await page.goto('/?scenario=collection&emptyProjects');
  await expect(
    page.getByRole('heading', { name: 'No projects yet' })
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Documentation' })
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'New project', exact: true })
    .last()
    .click();
  await expect(page.getByTestId('created-projects')).toHaveText('1');
  await page.screenshot({
    path: `/tmp/project-collection-empty-${info.project.name}.png`,
  });
});

test('filtered projects keep the separate no-results state', async ({
  page,
}, info) => {
  await open(page);
  if (info.project.name !== 'desktop') {
    await page.getByRole('button', { name: 'Open project filters' }).click();
    await page.getByRole('radio', { name: 'Assigned to me' }).click();
    await page.getByRole('radio', { name: 'Done', exact: true }).click();
    await page
      .getByRole('button', { name: 'Close filters', exact: true })
      .click();
  } else {
    await page
      .getByRole('button', { name: 'Search projects', exact: true })
      .click();
    await page
      .getByRole('searchbox', { name: 'Search projects' })
      .fill('no-project-matches');
  }
  await expect(
    page.getByText('No projects in this view', { exact: true })
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'No projects yet' })
  ).toHaveCount(0);
  await page
    .getByRole('button', { name: 'Clear Filters', exact: true })
    .click();
  await expect(page.getByRole('row', { name: /Alpha launch/ })).toBeVisible();
});
