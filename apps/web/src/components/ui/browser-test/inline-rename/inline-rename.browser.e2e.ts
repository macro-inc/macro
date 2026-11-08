import { expect, type Page, test } from '@playwright/test';

const FIXTURE = '/src/components/ui/browser-test/inline-rename/index.html';

async function open(page: Page) {
  await page.route('https://**', (route) => route.abort());
  const title = page.getByText('Launch plan', { exact: true });
  // A cold dev server reloads the page once it has optimized dependencies.
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.goto(FIXTURE);
    await page.waitForLoadState('networkidle');
    if (await title.isVisible()) return;
  }
  await expect(title).toBeVisible();
}

async function expectWholeNameSelected(page: Page, name: string) {
  const field = page.getByRole('textbox', { name: 'Name' });
  await expect(field).toBeFocused();
  await expect(field).toHaveValue(name);
  expect(
    await field.evaluate((input: HTMLInputElement) => [
      input.selectionStart,
      input.selectionEnd,
    ])
  ).toEqual([0, name.length]);
  return field;
}

test('the menu Rename opens the title field after the menu hands focus back', async ({
  page,
}, testInfo) => {
  await open(page);
  await page.getByRole('button', { name: 'File actions' }).click();
  await page.getByRole('menuitem', { name: 'Rename' }).click();
  const field = await expectWholeNameSelected(page, 'Launch plan');
  await page.screenshot({
    path: testInfo.outputPath(`title-rename-${testInfo.project.name}.png`),
  });
  await field.fill('Launch plan v2');
  await field.press('Enter');
  await expect(field).toHaveCount(0);
  await expect(page.getByText('Launch plan v2', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'File actions' })
  ).toBeFocused();
});

test('double-click renames a compact title, and Escape restores it', async ({
  page,
}) => {
  test.skip(
    test.info().project.name === 'phone',
    'Touch renames from the menu'
  );
  await open(page);
  await page.getByText('Launch plan', { exact: true }).dblclick();
  const field = await expectWholeNameSelected(page, 'Launch plan');
  await field.fill('Discarded');
  await field.press('Escape');
  await expect(field).toHaveCount(0);
  await expect(page.getByText('Launch plan', { exact: true })).toBeVisible();
});

test('a page heading opens on click and saves on blur; an empty name changes nothing', async ({
  page,
}) => {
  await open(page);
  await page.getByText('Summer offsite', { exact: true }).click();
  const field = page.getByRole('textbox', { name: 'Project name' });
  await expect(field).toBeFocused();
  await field.fill('Winter offsite');
  await page.getByText('Meeting notes', { exact: true }).click();
  await expect(field).toHaveCount(0);
  await expect(page.getByText('Winter offsite', { exact: true })).toBeVisible();

  await page.getByText('Winter offsite', { exact: true }).click();
  await field.fill('   ');
  await field.press('Enter');
  await expect(page.getByText('Winter offsite', { exact: true })).toBeVisible();
});

test('a row renames in place from its context menu and gives focus back to the row', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name === 'phone',
    'Touch rows rename from their long-press drawer'
  );
  await open(page);
  await page.getByText('Meeting notes', { exact: true }).click({
    button: 'right',
  });
  await page.getByRole('menuitem', { name: 'Rename' }).click();
  const field = await expectWholeNameSelected(page, 'Meeting notes');
  await page.screenshot({
    path: testInfo.outputPath(`row-rename-${testInfo.project.name}.png`),
  });
  await field.fill('Standup notes');
  await field.press('Enter');

  await expect(field).toHaveCount(0);
  await expect(page.getByRole('row', { name: 'Standup notes' })).toBeFocused();
});

test('a refused rename shows the old name again', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name === 'phone',
    'Touch rows rename from their long-press drawer'
  );
  await open(page);
  await page.getByText('Locked budget', { exact: true }).click({
    button: 'right',
  });
  await page.getByRole('menuitem', { name: 'Rename' }).click();
  const field = await expectWholeNameSelected(page, 'Locked budget');
  await field.fill('Open budget');
  await field.press('Enter');
  await expect(field).toHaveCount(0);
  await expect(page.getByText('Locked budget', { exact: true })).toBeVisible();
  await expect(page.getByText('Open budget', { exact: true })).toHaveCount(0);
});
