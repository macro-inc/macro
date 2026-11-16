import { expect, type Locator, type Page, test } from '@playwright/test';

const proof = () =>
  process.env.PASSWORDS_SCREENSHOT_DIR ?? test.info().outputDir;
async function drag(
  page: Page,
  from: Locator,
  to: Locator,
  cancel?: 'Escape' | 'blur'
) {
  const start = await from.boundingBox();
  const end = await to.boundingBox();
  if (!start || !end) throw new Error('Missing drag row');
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    start.x + start.width / 2 + 16,
    start.y + start.height / 2,
    { steps: 3 }
  );
  await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2, {
    steps: 12,
  });
  if (cancel === 'Escape') await page.keyboard.press('Escape');
  if (cancel === 'blur')
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await page.mouse.up();
}
async function createFolder(page: Page, name: string) {
  await page.getByRole('button', { name: 'New folder', exact: true }).click();
  await page.getByLabel('Folder name', { exact: true }).fill(name);
  await page.getByLabel('Folder name', { exact: true }).press('Enter');
}

test('Drive tree slots: context editing, real pointer folder/item moves and cancellation', async ({
  page,
}) => {
  test.setTimeout(360_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/src/features/passwords/browser-test/vault.html', {
    timeout: 240_000,
  });
  const tree = page.getByRole('navigation', { name: 'Folders' });
  const folder = (name: string) =>
    tree.getByRole('button', { name, exact: true });
  await createFolder(page, 'Alpha');
  await createFolder(page, 'Beta');
  await folder('Alpha').click({ button: 'right' });
  await page
    .getByRole('menuitem', { name: 'New subfolder', exact: true })
    .click();
  await expect(page.getByLabel('Folder name', { exact: true })).toBeFocused();
  await page.getByLabel('Folder name', { exact: true }).fill('Child');
  await page.getByLabel('Folder name', { exact: true }).press('Enter');
  await folder('Child').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Rename', exact: true }).click();
  await expect(page.getByLabel('Rename', { exact: true })).toBeFocused();
  await page.getByLabel('Rename', { exact: true }).fill('Renamed child');
  await page.getByLabel('Rename', { exact: true }).press('Escape');
  await expect(folder('Child')).toBeVisible();
  await folder('Child').click({ button: 'right' });
  await page.screenshot({ path: `${proof()}/context-menu-desktop.png` });
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Escape');
  await expect(
    page.getByRole('menuitem', { name: 'Rename', exact: true })
  ).toHaveCount(0);
  await folder('Child').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Rename', exact: true }).click();
  const name = page.getByLabel('Rename', { exact: true });
  await name.fill('Temporary');
  await drag(page, name, folder('Beta'));
  await expect(page.locator('body')).not.toHaveAttribute('data-folder-moves');
  await name.fill('Renamed child');
  await name.press('Enter');
  await expect(folder('Renamed child')).toBeVisible();
  await tree.getByRole('button', { name: 'Passwords', exact: true }).focus();
  await page.keyboard.press('Tab');
  await expect(folder('Alpha')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('heading', { name: 'Alpha', exact: true })
  ).toBeVisible();
  await folder('Beta').focus();
  await page.keyboard.press('Space');
  await expect(
    page.getByRole('heading', { name: 'Beta', exact: true })
  ).toBeVisible();
  await drag(page, folder('Alpha'), folder('Renamed child'));
  await expect(page.locator('body')).not.toHaveAttribute('data-folder-moves');
  await expect(folder('Renamed child')).toBeVisible();
  await drag(page, folder('Alpha'), folder('Beta'), 'Escape');
  await expect(folder('Renamed child')).toBeVisible();
  await drag(page, folder('Alpha'), folder('Beta'), 'blur');
  await expect(folder('Renamed child')).toBeVisible();
  await expect(page.locator('body')).not.toHaveAttribute('data-folder-moves');
  await drag(page, folder('Alpha'), folder('Beta'));
  await expect(page.locator('body')).toHaveAttribute('data-folder-moves', '1');
  // Destination is expanded after a successful normal API move.
  await expect(folder('Alpha')).toBeVisible();
  await folder('Alpha').click();
  await expect(
    page.getByRole('heading', { name: 'Alpha', exact: true })
  ).toBeVisible();
  await expect(
    page
      .getByRole('button', { name: 'New item in Beta / Alpha', exact: true })
      .last()
  ).toBeVisible();
  await page.screenshot({ path: `${proof()}/folder-moved-desktop.png` });
  // Root uses the same drop slot as a folder, and a drag never opens the source.
  await drag(
    page,
    folder('Alpha'),
    tree.getByRole('button', { name: 'Passwords', exact: true })
  );
  await expect(page.locator('body')).toHaveAttribute('data-folder-moves', '2');
  await folder('Alpha').click();
  await expect(
    page
      .getByRole('button', { name: 'New item in Beta / Alpha', exact: true })
      .last()
  ).toHaveCount(0);
  await page
    .getByRole('button', { name: /^New item in/ })
    .last()
    .click();
  await page.getByRole('menuitem', { name: 'Login', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill('Move fixture login');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const item = page.getByRole('button', { name: /Move fixture login/ }).first();
  await expect(item).toBeVisible();
  await drag(page, item, folder('Beta'));
  await expect(page.locator('body')).toHaveAttribute('data-item-moves', '1');
  await folder('Beta').click();
  await expect(
    page.getByRole('button', { name: /Move fixture login/ }).first()
  ).toBeVisible();
  await page.screenshot({ path: `${proof()}/item-moved-desktop.png` });
  await folder('Beta').click({ button: 'right' });
  await page
    .getByRole('menuitem', { name: 'Delete folder', exact: true })
    .click();
  await expect(page.getByText('1 item moves to All items.')).toBeVisible();
  await page.screenshot({ path: `${proof()}/delete-unfiles-desktop.png` });
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Delete folder' })
    .click();
  await expect(folder('Beta')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: /Move fixture login/ }).first()
  ).toBeVisible();
  expect(errors).toEqual([]);
});

for (const viewport of [
  { name: 'phone', width: 390, height: 844 },
  { name: 'tablet', width: 1024, height: 768 },
]) {
  test.describe(`${viewport.name} shared tree baseline`, () => {
    test.use({ hasTouch: true, isMobile: true });
    test('tap navigation and inline names remain usable without starting a drag', async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await page.goto('/src/features/passwords/browser-test/vault.html');
      const main = page.locator('[data-view-shell-main]');
      await main.getByRole('button', { name: 'Folders', exact: true }).tap();
      await main.getByRole('button', { name: 'New folder', exact: true }).tap();
      const input = main.getByLabel('Folder name', { exact: true });
      await expect(input).toBeFocused();
      await input.fill('Touch folder');
      await input.press('Enter');
      const folder = main
        .getByRole('navigation', { name: 'Folders' })
        .getByRole('button', { name: 'Touch folder', exact: true });
      await expect(folder).toBeVisible();
      await page.screenshot({
        path: `${proof()}/${viewport.name}-folder-tree.png`,
      });
      await folder.tap();
      await expect(
        main.getByRole('navigation', { name: 'Folders' })
      ).toHaveCount(0);
      await expect(
        main.getByText('This folder is empty', { exact: true })
      ).toBeVisible();
      await expect(page.locator('body')).not.toHaveAttribute(
        'data-folder-moves'
      );
    });
  });
}
