import { expect, test } from '@playwright/test';

for (const device of [
  {
    name: 'desktop',
    viewport: { width: 1280, height: 800 },
    touch: false,
    narrow: false,
  },
  {
    name: 'phone touch',
    viewport: { width: 390, height: 844 },
    touch: true,
    narrow: true,
  },
  {
    name: 'tablet touch',
    viewport: { width: 820, height: 1180 },
    touch: true,
    narrow: true,
  },
]) {
  test.describe(device.name, () => {
    test.use({
      viewport: device.viewport,
      hasTouch: device.touch,
      isMobile: device.touch,
    });

    test('leading editor opens without navigation, previews status, and rolls back a failed save', async ({
      page,
    }) => {
      await page.routeWebSocket('**', (socket) => socket.close());
      await page.goto(
        `/src/features/tasks-view/browser-test/task-status-control.html${device.narrow ? '?narrow=1' : ''}`
      );
      const row = page.getByLabel('Task with status');
      const leading = row.getByRole('button', { name: 'Change status' });
      await expect(leading).toHaveCount(1);
      await expect(
        row.getByRole('img', { name: 'Task: Not started' })
      ).toBeVisible();
      await leading.click();
      await expect(page.getByLabel('Navigation count')).toHaveText('0');
      await expect(page.getByRole('menu')).toBeVisible();
      await page
        .getByRole('menu')
        .getByText('In progress', { exact: true })
        .click();
      await expect(
        row.getByRole('img', { name: 'Task: In progress' })
      ).toBeVisible();
      await expect(page.getByLabel('Save requests')).toHaveText(
        '1 pending, 0 settled'
      );
      await expect(page.getByLabel('Navigation count')).toHaveText('0');
      await page.getByRole('button', { name: 'Fail save' }).click();
      await expect(
        row.getByRole('img', { name: 'Task: Not started' })
      ).toBeVisible();
      await expect(page.getByLabel('Save requests')).toHaveText(
        '1 pending, 1 settled'
      );
      await leading.click();
      await page
        .getByRole('menu')
        .getByText('In progress', { exact: true })
        .click();
      await expect(
        row.getByRole('img', { name: 'Task: In progress' })
      ).toBeVisible();
      await expect(page.getByLabel('Save requests')).toHaveText(
        '2 pending, 1 settled'
      );
      await page.getByRole('button', { name: 'Complete save' }).click();
      await expect(
        row.getByRole('img', { name: 'Task: In progress' })
      ).toBeVisible();
      await expect(page.getByLabel('Navigation count')).toHaveText('0');
    });

    test('missing status shows completion fallback and has one leading editor', async ({
      page,
    }) => {
      await page.routeWebSocket('**', (socket) => socket.close());
      await page.goto(
        `/src/features/tasks-view/browser-test/task-status-control.html${device.narrow ? '?narrow=1' : ''}`
      );
      const row = page.getByLabel('Task without status');
      await expect(
        row.getByRole('img', { name: 'Task: Completed' })
      ).toBeVisible();
      await expect(row.locator('[data-property-id]')).toHaveCount(
        device.narrow ? 1 : 3
      );
      await expect(
        row.locator(
          `[data-property-id="pending:00000001-0000-0000-0000-000000000002"]`
        )
      ).toHaveCount(1);
      await row.getByRole('button', { name: 'Change status' }).click();
      await expect(
        page.getByRole('menu').getByText('In progress', { exact: true })
      ).toBeVisible();
      await expect(page.getByLabel('Navigation count')).toHaveText('0');
    });
  });
}
