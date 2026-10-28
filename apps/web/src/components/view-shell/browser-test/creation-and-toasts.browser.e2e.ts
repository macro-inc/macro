import { expect, test } from '@playwright/test';

const fixture =
  '/src/components/view-shell/browser-test/creation-and-toasts.html';
for (const viewport of [
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'phone', width: 390, height: 844 },
]) {
  test.describe(viewport.name, () => {
    test.use({ hasTouch: viewport.name === 'phone' });
    test(`creation choices and notifications on ${viewport.name}`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await page.goto(fixture);
      const tabs = page.getByRole('radiogroup', { name: 'Channel views' });
      await tabs.getByText('Calls', { exact: true }).click();
      await expect(
        tabs.getByRole('radio', { name: 'Calls', exact: true })
      ).toBeChecked();
      if (viewport.name === 'desktop') {
        const labels = tabs.locator('label');
        const first = await labels.nth(0).boundingBox();
        const second = await labels.nth(1).boundingBox();
        const gap = second!.x - first!.x - first!.width;
        expect(gap).toBeGreaterThanOrEqual(2);
        expect(gap).toBeLessThanOrEqual(5);
      }
      await page
        .getByRole('button', { name: 'New task, subtask, project, or tag' })
        .click();
      const menu = page.getByRole('menu');
      await expect(
        menu.getByText(
          'Choose a parent task and break its work into a smaller step.'
        )
      ).toBeVisible();
      const bounds = await menu.boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width);
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: 'Show notices' }).click();
      await expect(page.locator('[data-macro-toast]')).toHaveCount(
        viewport.name === 'desktop' ? 3 : 1
      );
      await page.getByRole('button', { name: 'Show prompt' }).click();
      await expect(
        page.getByText('Demo only — no account changes.')
      ).toBeVisible();
      await page.getByRole('button', { name: 'Review', exact: true }).click();
      await expect(
        page.getByText('Reviewed demo — this preview does not save data.')
      ).toBeVisible();
    });
  });
}
