const { start, saved } = require('./compose.cjs');
const fs = require('node:fs');
module.exports = async (scene) => {
  await scene(
    '11-inline-image',
    'CID image resolves to real static-file storage',
    async ({ page, visit, check, expect, assert }) => {
      await visit('work:attachments');
      const img = page.locator('img[alt="Atlas launch mark"]');
      await check(
        'CID image downloads and decodes from local static-file storage',
        async () => {
          await expect(img).toBeVisible();
          await expect
            .poll(() => img.evaluate((e) => e.naturalWidth))
            .toBeGreaterThan(0);
          assert.ok(
            (await img.getAttribute('src')).includes('/static-file/file/')
          );
        }
      );
      await check(
        'Received file pills include the text and calendar attachments',
        async () => {
          await expect(
            page.getByText('launch-notes.txt', { exact: true })
          ).toBeVisible();
          await expect(
            page.getByText('launch-invite.ics', { exact: true })
          ).toBeVisible();
        }
      );
    }
  );
  for (const name of ['launch-notes.txt', 'launch-invite.ics'])
    await scene(
      '12-open-' + name.split('.').at(-1),
      'Open the actual seeded attachment in its routed viewer',
      async ({
        page,
        visit,
        check,
        expect,
        manifest,
        result,
        assert,
        sleep,
        context,
      }) => {
        await visit('work:attachments');
        await page.getByText(name, { exact: true }).first().click();
        await sleep(1800);
        await check(
          `${name} resolves its real document and opens the appropriate split`,
          async () => {
            assert.ok(
              result.responses.some(
                (r) =>
                  r.path.includes(manifest.attachments[name]) &&
                  r.status === 200
              )
            );
            await expect
              .poll(() => page.url())
              .toContain(manifest.attachmentDocuments[name]);
            await expect(
              page.getByText('Something went terribly wrong', { exact: true })
            ).toHaveCount(0);
          }
        );
        await expect(page.getByText(/No preview available/)).toBeVisible();
        const download = page.getByRole('button', { name: /^Download/ }).last();
        await expect(download).toBeVisible();
        {
          await page.evaluate(() => {
            const original = URL.createObjectURL;
            URL.createObjectURL = function (blob) {
              const url = original.call(URL, blob);
              window.__emailReviewDownload = blob
                .arrayBuffer()
                .then((bytes) => Array.from(new Uint8Array(bytes)));
              return url;
            };
          });
          const promise = page.waitForEvent('download');
          await download.click();
          const file = await promise;
          assert.equal(await file.failure(), null);
          assert.equal(file.suggestedFilename(), name);
          const target =
            '/tmp/email-exhaustive-review/artifacts/download-' + name;
          fs.writeFileSync(
            target,
            Buffer.from(await page.evaluate(() => window.__emailReviewDownload))
          );
          await check(
            `${name} downloads with matching original bytes`,
            async () =>
              assert.deepEqual(
                fs.readFileSync(target),
                fs.readFileSync('/tmp/email-exhaustive-review/assets/' + name)
              )
          );
        }
      }
    );
  await scene(
    '13-upload-remove',
    'Choose local files, persist to S3, reload, remove and enforce the size limit',
    async (t) => {
      const { page, check, expect, writes, origin, assert } = t;
      await start(t, 'Atlas assets — upload review');
      await saved(t, 'launch review is ready');
      const chooser = page.waitForEvent('filechooser');
      await page.getByRole('button', { name: 'Attach', exact: true }).click();
      await (await chooser).setFiles(
        '/tmp/email-exhaustive-review/assets/launch-notes.txt'
      );
      await check(
        'File picker adds the attachment and real upload metadata succeeds',
        async () => {
          await expect(
            page.getByText('launch-notes.txt', { exact: true })
          ).toBeVisible();
          await expect
            .poll(
              () =>
                writes.some(
                  (r) =>
                    r.method === 'POST' &&
                    r.path.endsWith('/attachments') &&
                    r.status < 300
                ),
              { timeout: 20000 }
            )
            .toBe(true);
        }
      );
      await saved(t, 'launch review is ready');
      await page.waitForTimeout(1500);
      const draft = writes
        .filter((r) => r.path.endsWith('/email/drafts') && r.saved)
        .at(-1);
      await page.goto(origin + '/app/email/' + draft.saved.thread);
      await expect(
        page.getByText('launch-notes.txt', { exact: true })
      ).toBeVisible({ timeout: 60000 });
      await check('Attachment is restored from the server after reload', () =>
        expect(
          page.getByText('launch-notes.txt', { exact: true })
        ).toBeVisible()
      );
      const pill = page
        .getByText('launch-notes.txt', { exact: true })
        .locator('..');
      await pill.locator('.ml-auto').click();
      await check(
        'Removing the file removes the backend attachment record',
        async () => {
          await expect(
            page.getByText('launch-notes.txt', { exact: true })
          ).toHaveCount(0);
          await expect
            .poll(() =>
              writes.some(
                (r) =>
                  r.method === 'DELETE' &&
                  r.path.includes('/attachments/') &&
                  r.status < 300
              )
            )
            .toBe(true);
        }
      );
      const large = page.waitForEvent('filechooser');
      await page.getByRole('button', { name: 'Attach', exact: true }).click();
      await (await large).setFiles({
        name: 'too-large.txt',
        mimeType: 'text/plain',
        buffer: Buffer.alloc(19 * 1024 * 1024),
      });
      await check(
        'Oversized file is rejected with an explicit size error',
        () =>
          expect(page.getByText(/exceed 18MB/).first()).toBeVisible({
            timeout: 20000,
          })
      );
    }
  );
  await scene(
    '14-forward-attachments',
    'Forward includes the original files and removal affects only the new draft',
    async (t) => {
      const { page, visit, check, expect, writes } = t;
      await visit('work:attachments');
      const card = page.locator('[data-message-body-id]').last();
      await card.click({ position: { x: 300, y: 15 } });
      await page.mouse.move(5, 5);
      await page.keyboard.press('f');
      const to = page
        .getByText('To', { exact: true })
        .last()
        .locator('..')
        .locator('input');
      await to.fill('priya@partner.test');
      await to.press('Enter');
      const editor = page.locator('[contenteditable=true]').last();
      await editor.click();
      await editor.press('Home');
      await editor.pressSequentially('Please review these launch files.');
      await check('Forwarded attachments are added to the real draft', () =>
        expect
          .poll(
            () =>
              writes.filter(
                (r) =>
                  r.method === 'POST' &&
                  r.path.includes('/forwarded-attachments') &&
                  r.status < 300
              ).length,
            { timeout: 20000 }
          )
          .toBe(2)
      );
      await page.waitForTimeout(1200);
      for (const name of ['launch-notes.txt', 'launch-invite.ics'])
        await expect(page.getByText(name, { exact: true })).toHaveCount(2);
      await page
        .getByRole('button', { name: 'Remove launch-notes.txt', exact: true })
        .click();
      await check(
        'Removing a forwarded file leaves the received original intact',
        async () => {
          await expect(
            page.getByText('launch-notes.txt', { exact: true })
          ).toHaveCount(1);
          await expect
            .poll(() =>
              writes.some(
                (r) =>
                  r.method === 'DELETE' &&
                  r.path.includes('/forwarded-attachments/') &&
                  r.status < 300
              )
            )
            .toBe(true);
        }
      );
      const keyboardRemove = page.getByRole('button', {
        name: 'Remove launch-invite.ics',
        exact: true,
      });
      await keyboardRemove.focus();
      await keyboardRemove.press('Enter');
      await check(
        'Keyboard removal also preserves the received original',
        async () => {
          await expect(
            page.getByText('launch-invite.ics', { exact: true })
          ).toHaveCount(1);
          await expect
            .poll(
              () =>
                writes.filter(
                  (r) =>
                    r.method === 'DELETE' &&
                    r.path.includes('/forwarded-attachments/') &&
                    r.status < 300
                ).length
            )
            .toBe(2);
        }
      );
    }
  );
};
