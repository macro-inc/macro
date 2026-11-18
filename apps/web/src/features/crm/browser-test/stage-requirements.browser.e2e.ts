import { expect, test } from '@playwright/test';

for (const viewport of [
  { width: 1280, height: 800 },
  { width: 390, height: 844 },
]) {
  test.describe(`${viewport.width}px`, () => {
    test.use({
      viewport,
      hasTouch: viewport.width === 390,
      isMobile: viewport.width === 390,
    });
    test(`configure requirements and retain a rejected deal at ${viewport.width}px`, async ({
      page,
    }) => {
      const activate = viewport.width === 390 ? 'tap' : 'click';
      await page.routeWebSocket('**', (socket) => socket.close());
      await page.route('https://**', (route) => route.abort());
      await page.route('**/__macro_dev/**', (route) => route.abort());
      await page.goto(
        '/src/features/crm/browser-test/stage-requirements.html',
        {
          waitUntil: 'domcontentloaded',
        }
      );
      await page
        .getByRole('button', { name: 'Stage requirements', exact: true })
        [activate]();
      let dialog = page.getByRole('dialog');
      await dialog.getByRole('button', { name: 'Required stage' })[activate]();
      await page
        .getByRole('menuitemradio', { name: 'Negotiation', exact: true })
        [activate]();
      await dialog.getByText('Amount', { exact: true })[activate]();
      await expect(
        dialog.getByRole('checkbox', { name: 'Amount' })
      ).toBeChecked();
      await page.screenshot({
        path: `/tmp/crm-3928-requirements-${viewport.width}.png`,
      });
      await dialog
        .getByRole('button', { name: 'Save requirements' })
        [activate]();
      await expect(dialog).not.toBeVisible();
      await page.getByRole('button', { name: 'Reject next save' })[activate]();
      await page
        .getByRole('button', { name: 'Add deal', exact: true })
        [activate]();
      dialog = page.getByRole('dialog');
      await dialog
        .getByRole('combobox', { name: 'Find or add a company' })
        .fill('Acme');
      await page.getByRole('option', { name: 'Acme', exact: true })[activate]();
      await dialog.getByRole('button', { name: /^Add deal/ })[activate]();
      await expect(dialog.getByRole('alert')).toContainText('Amount');
      await expect(dialog.getByText('acme.com')).toBeVisible();
      await page.screenshot({
        path: `/tmp/crm-3928-required-deal-${viewport.width}.png`,
      });
      await dialog.getByRole('button', { name: /Amount/ })[activate]();
      await dialog.getByRole('textbox', { name: 'Edit Amount' }).fill('2500');
      await dialog.getByRole('textbox', { name: 'Edit Amount' }).press('Enter');
      await dialog.getByRole('button', { name: /^Add deal/ })[activate]();
      await expect(dialog.getByRole('alert')).toContainText('Could not add');
      await expect(
        dialog.getByRole('button', { name: /Amount/ })
      ).toContainText('2,500');
      await dialog.getByRole('button', { name: /^Add deal/ })[activate]();
      await expect(dialog).not.toBeVisible();
      await expect(page.getByLabel('Saved deal')).toContainText('2500');
    });

    test('timeline creation keeps its dates and stage in the required-field form', async ({
      page,
    }) => {
      const activate = viewport.width === 390 ? 'tap' : 'click';
      await page.routeWebSocket('**', (socket) => socket.close());
      await page.route('https://**', (route) => route.abort());
      await page.route('**/__macro_dev/**', (route) => route.abort());
      await page.goto('/src/features/crm/browser-test/stage-requirements.html');
      await page.getByRole('button', { name: 'Open timeline' })[activate]();
      const row = page
        .locator('[data-timeline-group="option:negotiation"]')
        .first();
      await expect(row).toBeVisible();
      const box = await row.boundingBox();
      expect(box).not.toBeNull();
      await row.click({
        button: 'right',
        position: {
          x: Math.min(box!.width - 8, viewport.width - box!.x - 8),
          y: box!.height / 2,
        },
      });
      await page.getByRole('menuitem', { name: 'New record here' })[activate]();
      const dialog = page.getByRole('dialog');
      await expect(dialog.getByRole('button', { name: /Stage/ })).toContainText(
        'Negotiation'
      );
      await expect(
        dialog.getByRole('button', { name: /Schedule/ })
      ).not.toContainText('Empty');
      await dialog
        .getByRole('combobox', { name: 'Find or add a company' })
        .fill('Acme');
      await page.getByRole('option', { name: 'Acme', exact: true })[activate]();
      await dialog.getByRole('button', { name: /^Add deal/ })[activate]();
      await expect(dialog.getByRole('alert')).toContainText('Amount');
      await dialog.getByRole('button', { name: /Amount/ })[activate]();
      await dialog.getByRole('textbox', { name: 'Edit Amount' }).fill('100');
      await dialog.getByRole('textbox', { name: 'Edit Amount' }).press('Enter');
      await dialog.getByRole('button', { name: /^Add deal/ })[activate]();
      await expect(dialog).not.toBeVisible();
      const saved = JSON.parse(
        (await page.getByLabel('Saved deal').textContent())!
      );
      expect(saved).toMatchObject({ stage: 'Negotiation', amount: 100 });
      expect(saved.schedule).toMatch(/^\d{4}-.*Z\/\d{4}-.*Z$/);
    });
  });
}
