import { expect, test } from '@playwright/test';

for (const viewport of [
  { name: 'desktop', width: 1440, height: 960 },
  { name: 'phone', width: 390, height: 844 },
  { name: 'tablet', width: 1024, height: 768 },
]) {
  test.describe(viewport.name, () => {
    test.use({
      hasTouch: viewport.name !== 'desktop',
      isMobile: viewport.name !== 'desktop',
    });
    const pressMethod = viewport.name === 'desktop' ? 'click' : 'tap';
    test(`${viewport.name}: create, reveal, edit, cancel, generate and copy`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto('/src/features/passwords/browser-test/vault.html');
      await page
        .getByRole('button', { name: 'New item', exact: true })
        .last()
        [pressMethod]();
      await page.getByLabel('Name', { exact: true }).fill('Workspace login');
      await page.getByLabel('Username', { exact: true }).fill('fixture-user');
      await page
        .getByLabel('Password', { exact: true })
        .fill('initial-password');
      await page
        .getByRole('button', { name: 'Save', exact: true })
        .first()
        [pressMethod]();
      await expect(
        page.getByRole('heading', { name: 'Workspace login' })
      ).toBeVisible();
      await expect(
        page.getByText('initial-password', { exact: true })
      ).toHaveCount(0);
      await page
        .getByRole('button', { name: 'Reveal password', exact: true })
        [pressMethod]();
      await expect(
        page.getByText('initial-password', { exact: true })
      ).toBeVisible();
      await page
        .getByRole('button', { name: 'Copy password', exact: true })
        [pressMethod]();
      await expect(page.locator('body')).toHaveAttribute(
        'data-copied',
        'initial-password'
      );
      await page
        .getByRole('button', { name: 'Edit', exact: true })
        [pressMethod]();
      await page.getByLabel('Name', { exact: true }).fill('Discarded name');
      await page
        .getByRole('button', { name: 'Cancel', exact: true })
        [pressMethod]();
      await expect(
        page.getByRole('heading', { name: 'Workspace login' })
      ).toBeVisible();
      await page
        .getByRole('button', { name: 'Edit', exact: true })
        [pressMethod]();
      await page
        .getByRole('button', { name: 'Generate password', exact: true })
        [pressMethod]();
      await page
        .getByRole('menuitem', { name: 'Use password', exact: true })
        [pressMethod]();
      await expect(
        page.getByLabel('Password', { exact: true })
      ).not.toHaveValue('initial-password');
      await page
        .getByRole('button', { name: 'Save', exact: true })
        .first()
        [pressMethod]();
      await page
        .getByRole('button', { name: 'Reveal password', exact: true })
        [pressMethod]();
      await expect(
        page.getByText('initial-password', { exact: true })
      ).toHaveCount(0);
      await page.screenshot({
        path: `/tmp/passwords-${viewport.name}.png`,
        fullPage: true,
      });
      expect(errors).toEqual([]);
    });
  });
}

for (const viewport of [
  { name: 'desktop', width: 1440, height: 960 },
  { name: 'phone', width: 390, height: 844 },
  { name: 'tablet', width: 1024, height: 768 },
]) {
  test.describe(viewport.name, () => {
    test.use({
      hasTouch: viewport.name !== 'desktop',
      isMobile: viewport.name !== 'desktop',
    });
    const pressMethod = viewport.name === 'desktop' ? 'click' : 'tap';
    test(`${viewport.name}: folders, shared access, history, TOTP and unsaved guard`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await page.goto('/src/features/passwords/browser-test/vault.html');
      await page
        .getByRole('button', { name: 'New item', exact: true })
        .last()
        [pressMethod]();
      await page.getByLabel('Name', { exact: true }).fill('Team credential');
      await page
        .getByLabel('Password', { exact: true })
        .fill('fixture-only-secret');
      if (viewport.name === 'phone') {
        await page
          .getByRole('button', { name: 'Back', exact: true })
          [pressMethod]();
        await expect(page.getByText('You have unsaved changes.')).toBeVisible();
        await page
          .getByRole('button', { name: 'Keep editing', exact: true })
          [pressMethod]();
        await expect(page.getByLabel('Password', { exact: true })).toHaveValue(
          'fixture-only-secret'
        );
      }
      await page
        .getByRole('button', { name: 'Save', exact: true })
        .first()
        [pressMethod]();
      if (viewport.name === 'phone') {
        await page
          .getByRole('button', { name: 'Back', exact: true })
          [pressMethod]();
        await page
          .getByRole('button', { name: 'Password navigation', exact: true })
          [pressMethod]();
      }
      await page
        .getByRole('button', { name: 'New folder', exact: true })
        [pressMethod]();
      await page.getByLabel('Folder name', { exact: true }).fill('Operations');
      await page
        .getByRole('button', { name: 'Save', exact: true })
        [pressMethod]();
      if (viewport.name === 'phone') {
        await page
          .getByRole('button', { name: 'Password navigation', exact: true })
          [pressMethod]();
        await page
          .getByRole('button', { name: /Team credential/ })
          [pressMethod]();
      }
      await page
        .getByRole('button', { name: 'Move to folder', exact: true })
        [pressMethod]();
      await page
        .getByRole('menuitem', { name: 'Operations', exact: true })
        [pressMethod]();
      await page
        .getByRole('button', { name: 'Share', exact: true })
        [pressMethod]();
      await page
        .getByLabel('Search people and teams', { exact: true })
        .fill('Avery');
      await page
        .getByRole('button', { name: /Avery Lee.*Person/ })
        [pressMethod]();
      await page.screenshot({
        path: `/tmp/passwords-share-picker-${viewport.name}.png`,
        fullPage: true,
      });
      await page
        .getByRole('button', { name: 'Share', exact: true })
        .last()
        [pressMethod]();
      await expect(
        page.getByText('Avery Lee', { exact: true }).last()
      ).toBeVisible();
      await page.keyboard.press('Escape');
      await page
        .getByRole('button', { name: 'Password history', exact: true })
        [pressMethod]();
      await page
        .getByRole('menuitem', { name: 'Password history', exact: true })
        [pressMethod]();
      await page
        .getByRole('button', { name: 'Password history', exact: true })
        [pressMethod]();
      await page.getByRole('menuitem', { name: /Version 1/ })[pressMethod]();
      await expect(
        page.getByText('fixture-only-secret', { exact: true })
      ).toBeVisible();
      await page
        .getByRole('button', { name: 'Set up verification code', exact: true })
        [pressMethod]();
      await page
        .getByLabel('TOTP secret key', { exact: true })
        .fill('JBSWY3DPEHPK3PXP');
      await page
        .getByRole('button', { name: 'Save', exact: true })
        [pressMethod]();
      await page.keyboard.press('Escape');
      await page
        .getByRole('button', { name: 'Show verification code', exact: true })
        [pressMethod]();
      await expect(page.getByText('123456', { exact: true })).toBeVisible();
      await page.screenshot({
        path: `/tmp/passwords-main-flows-${viewport.name}.png`,
        fullPage: true,
      });
    });
  });
}
