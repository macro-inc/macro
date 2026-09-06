const { start, saved } = require('./compose.cjs');
module.exports = async (scene) => {
  await scene(
    '15-send-failure',
    'Controlled send failures preserve content, recipients and retry behavior',
    async (t) => {
      const { page, check, expect, assert, writes } = t;
      const editor = await start(t, 'Atlas — retry a failed send');
      await saved(t, 'launch review is ready');
      let sends = 0;
      const bodies = [];
      await page.route('**/email/messages', async (route) => {
        if (route.request().method() !== 'POST') return route.continue();
        sends++;
        bodies.push(route.request().postDataJSON());
        await new Promise((r) => setTimeout(r, 1400));
        await route.fulfill({
          status: 500,
          json: { message: 'Controlled local review failure' },
        });
      });
      await page.getByRole('button', { name: 'Send', exact: true }).click();
      await check('Pending send prevents a duplicate submission', () =>
        expect(
          page.getByRole('button', { name: 'Send', exact: true })
        ).toBeDisabled()
      );
      await check(
        'Failure is visible and leaves the message editable',
        async () => {
          await expect(
            page.getByText('Failed to send email', { exact: true })
          ).toBeVisible();
          await expect(editor).toContainText('The launch review is ready.');
          await expect(
            page.getByRole('button', { name: 'Send', exact: true })
          ).toBeEnabled();
        }
      );
      await page.getByRole('button', { name: 'Send', exact: true }).click();
      await expect.poll(() => sends).toBe(2);
      await expect(
        page.getByRole('button', { name: 'Send', exact: true })
      ).toBeEnabled();
      await check(
        'Retry submits exactly the same message and envelope',
        async () => assert.deepEqual(bodies[0], bodies[1])
      );
    },
    {
      evidence:
        'Real draft persistence; explicitly injected HTTP 500 at send transport',
    }
  );
  await scene(
    '16-load-failure',
    'A temporary thread failure cannot show another thread; recovery reloads the correct data',
    async ({ page, origin, manifest, check, expect, visit, sleep }) => {
      await page.route(
        '**/email/threads/' + manifest.threads['work:failure-cases'] + '?*',
        (route) =>
          route.fulfill({
            status: 500,
            json: { message: 'Controlled thread load failure' },
          })
      );
      await page.goto(
        origin + '/app/email/' + manifest.threads['work:failure-cases']
      );
      await sleep(12000);
      await check(
        'Failed initial load does not display an unrelated thread or editor',
        async () => {
          await expect(page.locator('[contenteditable=true]')).toHaveCount(0);
          await expect(page.locator('[data-message-body-id]')).toHaveCount(0);
        }
      );
      await expect(
        page.getByText('Unable to load this email', { exact: true })
      ).toBeVisible();
      await page.unroute(
        '**/email/threads/' + manifest.threads['work:failure-cases'] + '?*'
      );
      await page.getByRole('button', { name: 'Retry', exact: true }).click();
      await check('A recovered request renders the correct thread', () =>
        expect(page.locator('body')).toContainText(
          'Use this thread to verify transient loading and save failures.'
        )
      );
    },
    {
      evidence:
        'Real local thread after an explicitly injected initial HTTP 500',
    }
  );
  await scene(
    '17-triage',
    'Read/unread, done/undone and undo use real local mutations',
    async ({ page, visit, check, expect, writes, sleep, assert }) => {
      await visit('work:plain');
      const card = page.locator('[data-message-body-id]').last();
      await card.click({ position: { x: 300, y: 15 } });
      await page.mouse.move(5, 5);
      await page.keyboard.press('u');
      await sleep(1000);
      await page.keyboard.press('Shift+U');
      await sleep(1000);
      await check(
        'Keyboard read/unread actions reach the real backend',
        async () => {
          assert.ok(
            writes.some(
              (r) =>
                r.path.endsWith('/labels') &&
                r.status === 200 &&
                r.body.value === true
            )
          );
          assert.ok(
            writes.filter((r) => r.path.endsWith('/seen') && r.status === 200)
              .length >= 2
          );
        }
      );
      await page.keyboard.press('e');
      await expect(
        page.getByRole('button', { name: 'Undo', exact: true }).last()
      ).toBeVisible();
      await page
        .getByRole('button', { name: 'Undo', exact: true })
        .last()
        .click();
      await check('Undo reverses the archive mutation', async () => {
        await expect
          .poll(
            () =>
              writes.filter(
                (r) => r.path.endsWith('/archived') && r.status < 300
              ).length
          )
          .toBe(2);
        assert.deepEqual(
          writes
            .filter((r) => r.path.endsWith('/archived'))
            .map((r) => r.body.value),
          [true, false]
        );
      });
      await card.click({ position: { x: 300, y: 15 } });
      await page.mouse.move(5, 5);
      await page.keyboard.press('e');
      await sleep(1000);
      await card.click({ position: { x: 300, y: 15 } });
      await page.mouse.move(5, 5);
      await page.keyboard.press('Shift+E');
      await check('Shift+E also restores a completed thread', () =>
        expect
          .poll(
            () =>
              writes.filter(
                (r) => r.path.endsWith('/archived') && r.status < 300
              ).length
          )
          .toBe(4)
      );
    }
  );
  await scene(
    '18-inbox-choice',
    'Switch between primary, secondary and delegated senders; preserve the message',
    async (t) => {
      const { page, check, expect, writes, manifest, assert } = t;
      const editor = await start(t, 'Atlas — select the correct inbox');
      await saved(t, 'launch review is ready');
      for (const [key, email, signature] of [
        ['studio', 'studio@northstar.test', 'Northstar Studio · Design team'],
        ['support', 'support@northstar.test', 'Northstar Support'],
      ]) {
        await page
          .getByText('from', { exact: true })
          .locator('..')
          .getByRole('button')
          .click();
        await page.getByRole('menuitem').filter({ hasText: email }).click();
        await expect
          .poll(
            () =>
              writes.some(
                (r) =>
                  r.path.endsWith('/email/drafts') &&
                  r.status === 201 &&
                  r.linkId === manifest.links[key]
              ),
            { timeout: 20000 }
          )
          .toBe(true);
        await editor.click();
        await editor.press('End');
        await editor.pressSequentially(' ' + key + ' verified.');
        await saved(t, key + ' verified.');
        await check(
          `Switching to ${key} routes the draft to the correct inbox`,
          async () => {
            assert.equal(
              writes
                .filter(
                  (r) => r.path.endsWith('/email/drafts') && r.status === 201
                )
                .at(-1).linkId,
              manifest.links[key]
            );
            await expect(editor).toContainText('The launch review is ready.');
          }
        );
        const preview = page.getByRole('button', {
          name: 'Signature',
          exact: true,
        });
        if ((await preview.getAttribute('aria-expanded')) === 'false')
          await preview.click();
        await check(`${key} displays its own signature`, () =>
          expect(page.getByText(signature, { exact: true })).toBeVisible()
        );
      }
    }
  );
  await scene(
    '19-recipient-drag',
    'Invalid addresses, duplicate recipients and dragging To to Cc',
    async (t) => {
      const { page, check, expect, assert, writes } = t;
      await start(t, 'Atlas — envelope editing');
      await saved(t, 'launch review is ready');
      const to = page.locator('#email-compose-to-input');
      await to.fill('not-an-address');
      await to.press('Enter');
      await check('Invalid address does not become a selected recipient', () =>
        expect(
          page.locator('[draggable=true]').filter({ hasText: 'not-an-address' })
        ).toHaveCount(0)
      );
      await to.fill('');
      await to.fill('maya.email-review@seed.macro.local');
      await to.press('Enter');
      await check('Adding the same recipient does not duplicate its chip', () =>
        expect(page.locator('[draggable=true]')).toHaveCount(1)
      );
      await page.getByRole('button', { name: 'Cc', exact: true }).click();
      const cc = page.getByText('Cc', { exact: true }).last().locator('..');
      await page.locator('[draggable=true]').first().dragTo(cc);
      await check(
        'Dragging To to Cc moves the recipient without duplicating it',
        async () => {
          await expect(cc.locator('[draggable=true]')).toHaveCount(1);
          await expect(page.locator('[draggable=true]')).toHaveCount(1);
        }
      );
    }
  );
};
