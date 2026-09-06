const { start, saved } = require('./compose.cjs');
module.exports = async (scene) => {
  await scene(
    '22-navigation-flush',
    'Leaving compose flushes edits; reloading restores them; editor undo/redo stays local',
    async (t) => {
      const { page, origin, check, expect, assert } = t;
      const editor = await start(t, 'Atlas — navigation persistence');
      const draft = await saved(t, 'launch review is ready');
      await editor.press('End');
      await editor.pressSequentially(' Last-second change.');
      await page
        .getByRole('button', { name: 'Go to Email', exact: true })
        .click();
      await saved(t, 'Last-second change.');
      await page.goto(origin + '/app/email/' + draft.saved.thread);
      await check(
        'SPA navigation flushes the latest body before the debounce expires',
        () =>
          expect(page.locator('[contenteditable=true]').last()).toContainText(
            'Last-second change.',
            { timeout: 30000 }
          )
      );
      const current = page.locator('[contenteditable=true]').last();
      await current.click();
      await current.press('End');
      await current.pressSequentially(' Undo this sentence.');
      await current.press('ControlOrMeta+z');
      await check('Editor undo removes the latest insertion', () =>
        expect(current).not.toContainText('Undo this sentence.')
      );
      await current.press('ControlOrMeta+Shift+z');
      await check('Editor redo restores the insertion', () =>
        expect(current).toContainText('Undo this sentence.')
      );
    }
  );
  await scene(
    '23-independent-splits',
    'Two email threads keep expansion, selection and reply drafts independent',
    async (t) => {
      const { page, origin, manifest, check, expect, assert } = t;
      await page.goto(
        origin +
          '/app/email/' +
          manifest.threads['work:launch'] +
          '/email/' +
          manifest.threads['work:plain']
      );
      const first = page.locator(
          `[data-message-body-id="${manifest.launchMessages[0]}"]`
        ),
        second = page.locator(
          `[data-message-body-id="${manifest.messages['work:plain']}"]`
        );
      await expect(first).toBeVisible({ timeout: 60000 });
      await expect(second).toBeVisible();
      await first.click({ position: { x: 180, y: 15 } });
      await expect(
        first.getByText('design and timing', { exact: true })
      ).toBeVisible();
      await second.click({ position: { x: 180, y: 15 } });
      await check(
        'Collapsing the second thread leaves the first thread expanded',
        () =>
          expect(
            first.getByText('design and timing', { exact: true })
          ).toBeVisible()
      );
      await page.mouse.move(5, 5);
      await page.keyboard.press('r');
      const editor = second.locator('[contenteditable=true]').last();
      await expect(editor).toBeVisible();
      await editor.fill('A reply in the second split.');
      const draft = await saved(t, 'second split');
      await check(
        'Reply targets only the focused split while the other saved draft survives',
        async () => {
          assert.equal(
            draft.body.draft.replying_to_id,
            manifest.messages['work:plain']
          );
          await expect(
            page.locator(
              `[data-message-body-id="${manifest.launchMessages[3]}"] [contenteditable=true]`
            )
          ).toContainText('Ready to send the final agenda.');
        }
      );
    }
  );
  await scene(
    '24-hidden-messages',
    'Reveal collapsed middle messages with keyboard and keep a selected message expanded',
    async ({ page, visit, check, expect, assert }) => {
      await visit('work:long-history');
      const chip = page.locator('[data-hidden-messages]');
      await expect(chip).toBeVisible();
      const before = await page.locator('[data-message-body-id]').count();
      await chip.focus();
      await page.keyboard.press('Enter');
      await check(
        'Enter on the hidden-message control reveals the middle messages',
        async () => {
          await expect(chip).toHaveCount(0);
          assert.ok(
            (await page.locator('[data-message-body-id]').count()) > before
          );
        }
      );
      const card = page.locator('[data-message-body-id]').nth(3);
      await card.click({ position: { x: 280, y: 15 } });
      await page.mouse.move(5, 5);
      await page.keyboard.press('Escape');
      await check('Escape collapses the selected message body', async () => {
        assert.equal(
          await card
            .locator('div')
            .evaluateAll((es) => es.filter((e) => e.shadowRoot).length),
          0
        );
      });
    }
  );
  await scene(
    '25-free-watermark',
    'Free-user send includes the Macro signature; a failed send leaves the editor clean',
    async (t) => {
      const { page, check, expect, assert } = t;
      const editor = await start(t, 'Atlas — free account');
      await saved(t, 'launch review is ready');
      let payload;
      await page.route('**/email/messages', (route) => {
        payload = route.request().postDataJSON();
        return route.fulfill({
          status: 500,
          json: { message: 'Controlled send failure' },
        });
      });
      await page.getByRole('button', { name: 'Send', exact: true }).click();
      await expect(
        page.getByText('Failed to send email', { exact: true })
      ).toBeVisible();
      await check(
        'Free-user outgoing HTML includes a Macro watermark',
        async () => {
          const html = Buffer.from(
            payload.message.body_html,
            'base64url'
          ).toString();
          assert.ok(
            html.includes('data-watermark') ||
              html.includes('Sent with Macro') ||
              html.includes('macro.com'),
            html
          );
        }
      );
      await check(
        'Failure does not leave an injected watermark in the editable body',
        () => expect(editor.locator('[data-watermark]')).toHaveCount(0)
      );
    },
    {
      user: 'guest',
      evidence: 'Free local seed account; explicitly injected send HTTP 500',
    }
  );
  await scene(
    '26-ai-compose',
    'Real AI email tool consumer with a seeded pending draft; body edits persist through the real tool API',
    async ({
      page,
      origin,
      manifest,
      check,
      expect,
      assert,
      sleep,
      result,
    }) => {
      const updates = [];
      page.on('response', async (r) => {
        if (r.url().includes('/tool/update'))
          updates.push({
            status: r.status(),
            body: r.request().postDataJSON(),
          });
      });
      await page.goto(origin + '/app/chat/' + manifest.aiChat);
      const subject = page.getByPlaceholder('Subject', { exact: true });
      await expect(subject).toHaveValue('Atlas AI follow-up', {
        timeout: 60000,
      });
      const editor = page
        .locator('[contenteditable=true]')
        .filter({ hasText: 'Please review' })
        .first();
      await expect(editor).toBeVisible();
      await sleep(800);
      await check(
        'Opening the AI draft does not persist an initialization-only edit',
        async () => assert.equal(updates.length, 0)
      );
      await editor.click();
      await editor.press('End');
      await editor.pressSequentially(' Confirm accessibility before launch.', {
        delay: 25,
      });
      await check(
        'Body-only edits persist without requiring a subject or recipient change',
        () =>
          expect
            .poll(
              () =>
                updates.some(
                  (r) =>
                    r.status === 200 &&
                    Buffer.from(r.body.args.body, 'base64url')
                      .toString()
                      .includes('Confirm accessibility before launch.')
                ),
              { timeout: 12000 }
            )
            .toBe(true)
      );
      await page.reload();
      await check('Reloaded AI draft contains the edited body', () =>
        expect(
          page
            .locator('[contenteditable=true]')
            .filter({ hasText: 'Confirm accessibility before launch.' })
            .first()
        ).toBeVisible({ timeout: 30000 })
      );
    },
    {
      evidence:
        'Seeded AI tool output, real chat permissions and tool-edit APIs; no LLM generation',
    }
  );
  await scene(
    '27-mentions',
    'Mention a seeded document from the real composer',
    async (t) => {
      const { page, check, expect, sleep, manifest, assert } = t;
      const editor = await start(t, 'Atlas — linked launch brief');
      await editor.click();
      await editor.press('End');
      await editor.pressSequentially(' @Atlas launch brief', { delay: 60 });
      await sleep(1500);
      await page
        .getByText('Atlas launch brief', { exact: true })
        .last()
        .click();
      await check('The editor contains the selected document mention', () =>
        expect(editor).toContainText('Atlas launch brief')
      );
      const draft = await saved(t, 'Atlas launch brief');
      await check(
        'The saved mention retains its actual document identity',
        async () =>
          assert.ok(
            Buffer.from(draft.body.draft.body_html, 'base64url')
              .toString()
              .includes(manifest.documents.brief)
          )
      );
    }
  );
};
