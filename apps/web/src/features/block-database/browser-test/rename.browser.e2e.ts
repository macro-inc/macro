import { expect, test } from '@playwright/test';
import { openFixture } from './open-fixture';
import { RENAME_DETAIL } from './rename-data';

for (const phone of [false, true]) {
  test(`column rename never restores the old title or remounts the header (${phone ? 'phone' : 'desktop'})`, async ({
    browser,
  }) => {
    const context = await browser.newContext({
      viewport: { width: phone ? 390 : 1280, height: 800 },
      hasTouch: phone,
    });
    const page = await context.newPage();
    const stored = structuredClone(RENAME_DETAIL);
    let releaseWrite!: () => void;
    let releaseSchema!: () => void;
    const writeGate = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    const schemaGate = new Promise<void>((resolve) => {
      releaseSchema = resolve;
    });
    let committed = false;
    let sawWrite!: () => void;
    const submitted = new Promise<void>((resolve) => {
      sawWrite = resolve;
    });
    let sawRefresh!: () => void;
    const refreshing = new Promise<void>((resolve) => {
      sawRefresh = resolve;
    });
    await page.route('https://**', (route) => route.abort());
    await page.route('**/__macro_dev/**', (route) => route.abort());
    await page.route('**/databases/db', async (route) => {
      if (committed) {
        sawRefresh();
        await schemaGate;
      }
      await route.fulfill({ json: stored });
    });
    await page.route('**/databases/db/ops', async (route) => {
      const { ops } = route.request().postDataJSON();
      expect(ops[0].change).toEqual({
        kind: 'rename',
        name: 'Task',
        previousName: 'Name',
      });
      sawWrite();
      await writeGate;
      stored.tables[0].columns[0].column.display_name = 'Task';
      stored.tables[0].columns[0].sql_name = '"Task"';
      stored.tables[0].table.version = 2;
      committed = true;
      await route.fulfill({
        json: {
          results: [
            {
              kind: 'column',
              table: 'tasks',
              column: 'name',
              tableVersion: 2,
              change: { kind: 'renamed' },
            },
          ],
          changes: [],
        },
      });
    });
    await openFixture(
      page,
      '/src/features/block-database/browser-test/rename.html'
    );
    const header = page.getByRole('columnheader', {
      name: 'Name',
      exact: true,
    });
    await expect(header).toBeVisible();
    await header.evaluate((element) => {
      element.setAttribute('data-rename-original', 'true');
      const names: string[] = [];
      Object.assign(window, { renameNames: names });
      new MutationObserver(() => {
        names.push(element.getAttribute('aria-label') ?? '');
      }).observe(element, {
        attributes: true,
        attributeFilter: ['aria-label'],
      });
    });
    await header.dblclick();
    await page
      .getByRole('textbox', { name: 'Column name', exact: true })
      .fill('Task');
    await page
      .getByRole('textbox', { name: 'Column name', exact: true })
      .press('Enter');
    await submitted;
    await expect(
      page.getByRole('columnheader', { name: 'Task', exact: true })
    ).toBeVisible();
    releaseWrite();
    await refreshing;
    // The write has committed, but the schema refetch is still held. Let the
    // controller finish the save and reveal any fallback to its old props.
    await page
      .locator('[data-rename-original]')
      .getByRole('button', { name: /column menu$/ })
      .click();
    await expect(
      page.getByRole('menuitem', { name: 'Rename column', exact: true })
    ).toBeEnabled();
    await page.getByText('Planning', { exact: true }).click();
    await expect(page.getByRole('menu')).toHaveCount(0);
    await page.screenshot({
      path: `${process.env.RENAME_PROOF_DIR ?? '/tmp/column-rename-proof'}/${phone ? 'phone' : 'desktop'}.png`,
    });
    await expect(page.locator('[data-rename-original]')).toHaveAttribute(
      'aria-label',
      'Task'
    );
    expect(
      await page.evaluate(() => Reflect.get(window, 'renameNames'))
    ).toEqual(['Task']);
    releaseSchema();
    await expect(
      page.getByRole('columnheader', { name: 'Task', exact: true })
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole('columnheader', { name: 'Task', exact: true })
    ).toBeVisible();
    await context.close();
  });
}
