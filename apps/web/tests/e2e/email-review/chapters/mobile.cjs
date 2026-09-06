const { saved, start } = require('./compose.cjs');
module.exports = async (scene) => {
  for (const action of ['reply', 'forward'])
    await scene(
      '20-mobile-' + action,
      'Touch layout: recipients, draft save, drawer close/reopen and a reduced keyboard viewport',
      async (t) => {
        const { page, visit, check, expect, assert, sleep } = t;
        await visit('work:personal');
        await page
          .getByRole('button', {
            name: action === 'forward' ? 'Forward' : 'Reply',
            exact: true,
          })
          .last()
          .click();
        const dialog = page.getByRole('dialog', { name: 'Reply composer' });
        const editor = dialog.locator('[contenteditable=true]').last();
        await expect(editor).toBeVisible();
        const row = (label) =>
          dialog
            .getByText(label + ':', { exact: true })
            .last()
            .locator('..');
        if (action === 'forward') {
          const to = row('To').locator('input');
          await expect(to).toBeFocused();
          await to.fill('priya@partner.test');
          await to.press('Enter');
        }
        await row('To').locator('button[aria-expanded]').click();
        for (const [label, email] of [
          ['Cc', 'noah@northstar.test'],
          ['Bcc', 'copy@northstar.test'],
        ]) {
          const input = row(label).locator('input');
          await input.fill(email);
          await input.press('Enter');
        }
        await editor.click();
        await editor.press('Home');
        await editor.pressSequentially(
          `Mobile ${action}: the launch is ready.`,
          { delay: 35 }
        );
        await saved(t, `Mobile ${action}`);
        await check('Touch composer saves body, Cc and Bcc', async () => {
          await expect(editor).toContainText(`Mobile ${action}`);
          await expect(row('Bcc')).toContainText('copy@northstar.test');
          assert.ok(
            await page.evaluate(() => matchMedia('(pointer:coarse)').matches)
          );
        });
        await page.mouse.click(8, 20);
        await expect(dialog).toBeHidden();
        await page
          .getByRole('button', {
            name: action === 'forward' ? 'Forward' : 'Reply',
            exact: true,
          })
          .last()
          .click();
        await check(
          'Closing and reopening the drawer preserves the saved draft',
          () =>
            expect(
              dialog.locator('[contenteditable=true]').last()
            ).toContainText(`Mobile ${action}`)
        );
        await page.setViewportSize({ width: 390, height: 520 });
        await sleep(700);
        await editor.click();
        await check(
          'Drawer and send control fit within the reduced viewport',
          async () => {
            const b = await dialog.boundingBox();
            assert.ok(
              b.x >= -1 &&
                b.x + b.width <= 391 &&
                b.y >= -1 &&
                b.y + b.height <= 521,
              JSON.stringify(b)
            );
            const send = await dialog
              .getByRole('button', { name: 'Send', exact: true })
              .boundingBox();
            assert.ok(
              send.y >= 0 && send.y + send.height <= 520,
              JSON.stringify(send)
            );
            await expect(
              dialog.getByRole('button', { name: 'Send', exact: true })
            ).toBeVisible();
          }
        );
        await page.setViewportSize({ width: 390, height: 844 });
        await dialog
          .getByRole('button', { name: 'Delete draft', exact: true })
          .click();
        await check('Discard closes the mobile draft', () =>
          expect(dialog).toBeHidden()
        );
      },
      { mobile: true }
    );
  await scene(
    '21-mobile-compose',
    'Standalone compose and persisted draft on a phone-sized touch viewport',
    async (t) => {
      const { page, check, expect, assert } = t;
      const editor = await start(t, 'Mobile launch follow-up');
      await saved(t, 'launch review is ready');
      await check(
        'Standalone compose saves and fits the mobile viewport',
        async () => {
          await expect(editor).toContainText('The launch review is ready.');
          assert.ok(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth
            )
          );
          await expect(
            page.getByRole('button', { name: 'Send', exact: true })
          ).toBeVisible();
        }
      );
    },
    { mobile: true }
  );
};
