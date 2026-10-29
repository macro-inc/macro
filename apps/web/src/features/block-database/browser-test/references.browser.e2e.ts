import { expect, test } from '@playwright/test';
import { openFixture } from './open-fixture';

test('opens file references and replaces them from the cell context menu', async ({
  page,
}) => {
  await page.route('https://**', (route) => route.abort());
  await page.route('**/__macro_dev/**', (route) => route.abort());
  await openFixture(
    page,
    '/src/features/block-database/browser-test/records.html?references'
  );
  const grid = page.getByRole('grid', { name: 'Embedded records' });
  const file = page.getByRole('button', { name: 'File: Project plan' });
  await file.click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(
    page.getByRole('complementary', { name: 'Opened file' })
  ).toContainText('Project plan');
  await expect(grid).toBeVisible();
  await file.click({ button: 'right' });
  const picker = page.getByRole('dialog', { name: 'Choose file' });
  await expect(picker).toBeVisible();
  await expect(page.getByRole('menu')).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Find a file' }).press('Escape');
  await expect(picker).toHaveCount(0);
  await expect(file).toBeFocused();
  await file.click({ button: 'right' });
  await picker.getByRole('button', { name: 'Design notes' }).click();
  const replacement = page.getByRole('button', { name: 'File: Design notes' });
  await expect(replacement).toBeVisible();
  await expect(page.getByLabel('Stored records')).toContainText('design-notes');
  await replacement.focus();
  await replacement.press('Enter');
  await expect(
    page.getByRole('complementary', { name: 'Opened file' })
  ).toContainText('Design notes');
  await replacement.press('F2');
  await expect(picker).toBeVisible();
  await page.getByRole('textbox', { name: 'Find a file' }).press('Escape');
  await page.getByRole('button', { name: 'Read only', exact: true }).click();
  await replacement.click();
  await expect(grid).toBeVisible();
  await replacement.click({ button: 'right' });
  await expect(picker).toHaveCount(0);
});

test.describe('touch references', () => {
  test.use({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  test('empty file references still pick on click and touch taps open populated files', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.route('https://**', (route) => route.abort());
    await page.route('**/__macro_dev/**', (route) => route.abort());
    await openFixture(
      page,
      '/src/features/block-database/browser-test/records.html?references'
    );
    const file = page.getByRole('button', { name: 'File: Project plan' });
    await file.focus();
    await file.press('Delete');
    const empty = page.getByRole('button', { name: /^File: Empty/ }).first();
    await empty.click();
    await page
      .getByRole('dialog', { name: 'Choose file' })
      .getByRole('button', { name: 'Design notes' })
      .click();
    await page.getByRole('button', { name: 'File: Design notes' }).tap();
    await expect(
      page.getByRole('complementary', { name: 'Opened file' })
    ).toContainText('Design notes');
    await expect(
      page.getByRole('grid', { name: 'Embedded records' })
    ).toBeVisible();
  });
});
