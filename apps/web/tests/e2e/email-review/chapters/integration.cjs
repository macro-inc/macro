const { start, saved } = require('./compose.cjs');
const fs = require('node:fs');
module.exports = async (scene) => {
  await scene(
    '28-sender-commands',
    'Sender commands target the original correspondent and use real local mutations',
    async ({ page, visit, check, expect, assert, writes, manifest }) => {
      await visit('work:launch');
      await page
        .locator('[data-message-body-id]')
        .last()
        .click({ position: { x: 240, y: 15 } });
      await page.mouse.move(5, 5);
      for (const [token, label] of [
        ['email.markSenderNoise', 'Mark sender as Noise'],
        ['email.markSenderSignal', 'Mark sender as Signal'],
        ['email.blockSender', 'Block sender'],
      ]) {
        const writeStart = writes.length;
        await page.keyboard.press('ControlOrMeta+k');
        const search = page.getByPlaceholder('Search...', { exact: true });
        await search.fill(label);
        await page.getByText(label, { exact: true }).last().click();
        await check(label + ' uses the original sender', async () => {
          await expect
            .poll(() =>
              writes
                .slice(writeStart)
                .some(
                  (r) =>
                    r.path.endsWith(
                      token === 'email.blockSender'
                        ? '/contacts/block'
                        : '/filters'
                    ) &&
                    r.status < 300 &&
                    r.body?.email_address === manifest.users.maya.email &&
                    (token === 'email.blockSender' ||
                      r.body.is_important ===
                        (token === 'email.markSenderSignal'))
                )
            )
            .toBe(true);
        });
      }
      await page.evaluate(async (email) => {
        const { emailClient } = await import(
          '/src/lib/service-clients/service-email/client.ts'
        );
        const r = await emailClient.unblockSender({ email_address: email });
        if (r.isErr()) throw new Error('Unable to undo seeded sender block');
      }, manifest.users.maya.email);
      await check('The seed sender is unblocked again', () =>
        expect
          .poll(() =>
            writes.some(
              (r) => r.path.endsWith('/contacts/unblock') && r.status < 300
            )
          )
          .toBe(true)
      );
    }
  );
  await scene(
    '29-upload-recovery',
    'Failed upload rolls back metadata; retry waits for actual bytes before send',
    async (t) => {
      const { page, check, expect, assert, writes, output } = t;
      const editor = await start(t, 'Atlas — attachment retry');
      await saved(t, 'launch review is ready');
      let attempts = 0,
        release;
      const hold = new Promise((resolve) => (release = resolve));
      let uploadUrl;
      await page.route('**/macro-email-attachments/**', async (route) => {
        if (route.request().method() !== 'PUT') return route.fallback();
        attempts++;
        uploadUrl = route.request().url();
        if (attempts === 1)
          return route.fulfill({
            status: 500,
            body: 'Controlled upload failure',
          });
        await hold;
        await route.fallback();
      });
      try {
        const chooser = page.waitForEvent('filechooser');
        await page.getByRole('button', { name: 'Attach', exact: true }).click();
        await (await chooser).setFiles(output + '/assets/launch-notes.txt');
        await expect(
          page.getByText('Failed to save attachments', { exact: true })
        ).toBeVisible();
        await check(
          'Failed upload removes its incomplete attachment record',
          () =>
            expect
              .poll(() =>
                writes.some(
                  (r) =>
                    r.method === 'DELETE' &&
                    r.path.includes('/attachments/') &&
                    r.status < 300
                )
              )
              .toBe(true)
        );
        await editor.click();
        await editor.press('End');
        await editor.pressSequentially(' Retrying the file upload.');
        await expect.poll(() => attempts).toBe(2);
        let sends = 0;
        await page.route('**/email/messages', (route) => {
          sends++;
          return route.fulfill({
            status: 500,
            json: { message: 'Controlled send failure after verified upload' },
          });
        });
        await page.getByRole('button', { name: 'Send', exact: true }).click();
        await check('Send waits for an earlier unfinished upload', async () => {
          await expect(
            page.getByRole('button', { name: 'Send', exact: true })
          ).toBeDisabled();
          assert.equal(sends, 0);
        });
        release();
        await expect(
          page.getByText('Failed to send email', { exact: true })
        ).toBeVisible();
        await check(
          'Retried upload stores the original bytes before send dispatch',
          async () => {
            assert.equal(sends, 1);
            const url = uploadUrl.replace(
              'http://localstack:4566',
              'http://localhost:24706'
            );
            const response = await fetch(url);
            assert.equal(response.status, 200);
            assert.deepEqual(
              Buffer.from(await response.arrayBuffer()),
              fs.readFileSync(output + '/assets/launch-notes.txt')
            );
          }
        );
      } finally {
        release();
      }
    },
    {
      evidence:
        'Real metadata and S3 retry; explicitly injected first-upload failure and final-send failure',
    }
  );
  await scene(
    '30-pasted-image',
    'Paste a local image through the editor and persist its uploaded file reference',
    async (t) => {
      const { page, check, expect, assert, output, writes } = t;
      const editor = await start(t, 'Atlas — pasted design image');
      await saved(t, 'launch review is ready');
      const uploads = [];
      page.on('response', async (r) => {
        if (
          r.request().method() === 'PUT' &&
          new URL(r.url()).pathname === '/static-file/api/file' &&
          r.ok()
        ) {
          const v = await r.json();
          uploads.push(v.id);
        }
      });
      await editor.click();
      await editor.press('End');
      await editor.evaluate(
        (element, base64) => {
          const file = new File(
            [Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))],
            'pasted-atlas.png',
            { type: 'image/png' }
          );
          const data = new DataTransfer();
          data.items.add(file);
          element.dispatchEvent(
            new ClipboardEvent('paste', {
              clipboardData: data,
              bubbles: true,
              cancelable: true,
            })
          );
        },
        fs.readFileSync(output + '/assets/atlas-mark.png').toString('base64')
      );
      await check(
        'Pasting creates a real uploaded image and inserts it into the editor',
        async () => {
          await expect.poll(() => uploads.length, { timeout: 30000 }).toBe(1);
          await expect(editor.locator('img').last()).toBeVisible({
            timeout: 30000,
          });
        }
      );
      await editor.press('End');
      await editor.pressSequentially(' Pasted image verified.');
      const draft = await saved(t, 'Pasted image verified.');
      await check('Saved HTML includes the uploaded image identity', async () =>
        assert.ok(
          Buffer.from(draft.body.draft.body_html, 'base64url')
            .toString()
            .includes(uploads[0])
        )
      );
    },
    {
      evidence:
        'Real editor paste event, static-file API, local storage and draft persistence',
    }
  );
  for (const entry of ['inbox', 'direct'])
    await scene(
      '31-notification-' + entry,
      'Marking an email done settles its notification; Undo restores both (' +
        entry +
        ' entry)',
      async ({ page, manifest, check, expect, assert, visit, writes }) => {
        const read = () =>
          page.evaluate(async (id) => {
            const { notificationServiceClient } = await import(
              '/src/lib/service-clients/service-notification/client.ts'
            );
            const r =
              await notificationServiceClient.getUserNotificationById(id);
            if (r.isErr()) throw new Error('Cannot read seeded notification');
            return r.value;
          }, manifest.notificationId);
        if (entry === 'direct') await visit('work:plain');
        else {
          await page.getByText('Signal', { exact: true }).last().click();
          await page
            .getByText('Plaintext checklist — release readiness', {
              exact: true,
            })
            .first()
            .click();
        }
        const card = page.locator('[data-message-body-id]').last();
        await expect(card).toBeVisible({ timeout: 60000 });
        await card.click({ position: { x: 230, y: 15 } });
        await page.mouse.move(5, 5);
        await check('The email has a real active notification', async () =>
          assert.equal((await read()).done, false)
        );
        await page.keyboard.press('e');
        await expect.poll(async () => (await read()).done).toBe(true);
        await page
          .getByRole('button', { name: 'Undo', exact: true })
          .last()
          .click();
        await check(
          'Undo restores both the email and its notification',
          async () => {
            await expect.poll(async () => (await read()).done).toBe(false);
            await expect
              .poll(() =>
                writes
                  .filter((r) => r.path.endsWith('/archived') && r.status < 300)
                  .map((r) => r.body.value)
              )
              .toEqual([true, false]);
          }
        );
        await page.reload();
        await check('Notification restoration survives reload', async () => {
          assert.equal((await read()).done, false);
          await expect(
            page.getByText('Something went terribly wrong', { exact: true })
          ).toHaveCount(0);
        });
      }
    );
  for (const [key, label] of [
    ['studio:client-brief', 'secondary'],
    ['support:customer', 'delegated'],
  ])
    await scene(
      '32-done-' + label,
      'Fresh direct entry: ' + label + ' inbox archive and Undo',
      async ({ page, visit, manifest, check, expect, writes, assert }) => {
        await visit(key);
        const card = page.locator('[data-message-body-id]').last();
        await card.click({ position: { x: 230, y: 15 } });
        await page.mouse.move(5, 5);
        await page.keyboard.press('e');
        await check(
          'Mark done reaches the correct ' + label + ' thread',
          async () => {
            await expect
              .poll(() =>
                writes.some(
                  (r) =>
                    r.path.endsWith(
                      '/threads/' + manifest.threads[key] + '/archived'
                    ) &&
                    r.status < 300 &&
                    r.body.value === true
                )
              )
              .toBe(true);
          }
        );
        await page
          .getByRole('button', { name: 'Undo', exact: true })
          .last()
          .click();
        await check('Undo restores the same ' + label + ' thread', () =>
          expect
            .poll(() =>
              writes
                .filter(
                  (r) =>
                    r.path.endsWith(
                      '/threads/' + manifest.threads[key] + '/archived'
                    ) && r.status < 300
                )
                .map((r) => r.body.value)
            )
            .toEqual([true, false])
        );
      }
    );
};
