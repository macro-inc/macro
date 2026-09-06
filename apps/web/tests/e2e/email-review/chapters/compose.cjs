async function start(
  { page, origin, expect },
  subject = 'Atlas follow-up — browser review'
) {
  await page.goto(origin + '/app/component/email-compose');
  await expect(page.locator('#email-compose-to-input')).toBeVisible({
    timeout: 60000,
  });
  const to = page.locator('#email-compose-to-input');
  await to.fill('maya.email-review@seed.macro.local');
  await to.press('Enter');
  await page
    .locator('input[placeholder=Subject], textarea')
    .first()
    .fill(subject);
  const editor = page.locator('[contenteditable=true]').last();
  await editor.fill(
    'The launch review is ready. Please check the agenda and accessibility notes.'
  );
  return editor;
}
async function saved({ writes, expect }, text) {
  await expect
    .poll(
      () =>
        writes.filter(
          (r) =>
            r.path.endsWith('/email/drafts') &&
            r.status === 201 &&
            Buffer.from(r.body?.draft?.body_html || '', 'base64url')
              .toString()
              .includes(text)
        ).length,
      { timeout: 20000 }
    )
    .toBeGreaterThan(0);
  return writes
    .filter((r) => r.path.endsWith('/email/drafts') && r.status === 201)
    .at(-1);
}
module.exports = async (scene) => {
  await scene(
    '07-compose-envelope',
    'To/Cc/Bcc, rich formatting, saved draft reload, signature and discard',
    async (t) => {
      const { page, check, expect, writes, assert, origin } = t;
      const editor = await start(t);
      for (const [label, email] of [
        ['Cc', 'noah@northstar.test'],
        ['Bcc', 'priya@partner.test'],
      ]) {
        await page.getByRole('button', { name: label, exact: true }).click();
        const input = page
          .getByText(label, { exact: true })
          .last()
          .locator('..')
          .locator('input');
        await input.fill(email);
        await input.press('Enter');
      }
      await page.getByRole('button', { name: 'Format', exact: true }).click();
      await editor.click();
      await editor.press('ControlOrMeta+a');
      await page.getByRole('button', { name: 'Bold', exact: true }).click();
      await check('Rich text formatting preserves the selected text', () =>
        expect(editor.locator('b,strong')).toContainText(
          'The launch review is ready.'
        )
      );
      const draft = await saved(t, '<b>');
      await check(
        'Real draft save contains To, Cc, Bcc and formatted HTML',
        async () => {
          assert.equal(
            draft.body.draft.to[0].email,
            'maya.email-review@seed.macro.local'
          );
          assert.equal(draft.body.draft.cc[0].email, 'noah@northstar.test');
          assert.equal(draft.body.draft.bcc[0].email, 'priya@partner.test');
          assert.ok(draft.saved.id);
        }
      );
      await page.goto(origin + '/app/email/' + draft.saved.thread);
      await expect(page.locator('[contenteditable=true]').last()).toContainText(
        'The launch review is ready.',
        { timeout: 60000 }
      );
      await check(
        'Reloading from the server restores the complete draft',
        async () => {
          await expect(page.locator('body')).toContainText('Priya Shah');
          await expect(
            page.locator('[contenteditable=true]').last().locator('b,strong')
          ).toContainText('The launch review is ready.');
        }
      );
      await page
        .getByRole('button', { name: 'Signature', exact: true })
        .click();
      await check('Seeded signature expands for review', () =>
        expect(page.locator('body')).toContainText('Alex Morgan · Northstar')
      );
      await page
        .getByRole('button', { name: "Don't include signature", exact: true })
        .click();
      await check('Signature can be excluded', () =>
        expect(
          page.getByRole('button', { name: 'Signature', exact: true })
        ).toHaveCount(0)
      );
      await page
        .getByRole('button', { name: 'Delete draft', exact: true })
        .click();
      await check('Discard reaches the real backend', () =>
        expect
          .poll(() =>
            writes.some(
              (r) =>
                r.method === 'DELETE' &&
                r.path.includes('/drafts/') &&
                r.status < 300
            )
          )
          .toBe(true)
      );
    }
  );
  for (const action of ['reply', 'reply-all', 'forward'])
    await scene(
      '08-' + action,
      action === 'forward'
        ? 'Forward target, recipients, quote and real persistence'
        : `Existing ${action === 'reply' ? 'R' : 'Alt/Option+R'} reply-all behavior: target, recipients and persistence`,
      async (t) => {
        const { page, visit, manifest, expect, check, assert, writes } = t;
        await visit('work:launch');
        const targetId =
          action === 'reply-all'
            ? manifest.launchMessages[1]
            : manifest.launchMessages.at(-1);
        const card = page.locator(`[data-message-body-id="${targetId}"]`);
        await card.scrollIntoViewIfNeeded();
        await card.click({ position: { x: 300, y: 15 } });
        await page.mouse.move(5, 5);
        await page.keyboard.press(
          action === 'forward' ? 'f' : action === 'reply-all' ? 'Alt+r' : 'r'
        );
        const editor = card.locator('[contenteditable=true]').last();
        await expect(editor).toBeVisible();
        const collapsed = card.getByRole('button', {
          name: /^(Replying to|Forwarding)/,
        });
        if (await collapsed.isVisible()) await collapsed.click();
        const row = (label) =>
          card.getByText(label, { exact: true }).last().locator('..');
        if (action === 'forward') {
          const to = row('To').locator('input');
          await check(
            'Forward starts with an empty recipient and focuses To',
            () => expect(to).toBeFocused()
          );
          await to.fill('priya@partner.test');
          await to.press('Enter');
        }
        await editor.click();
        await editor.press('Home');
        await editor.pressSequentially(
          `Verified ${action}: the launch agenda is ready.`,
          { delay: 25 }
        );
        const draft = await saved(t, `Verified ${action}`);
        await check(
          'Envelope and target are correct in the persisted draft',
          async () => {
            assert.equal(draft.body.draft.replying_to_id, targetId);
            assert.equal(
              draft.body.draft.to[0].email,
              action === 'forward'
                ? 'priya@partner.test'
                : 'maya.email-review@seed.macro.local'
            );
            if (action === 'reply-all')
              assert.ok(
                draft.body.draft.cc.some(
                  (r) => r.email === 'noah@northstar.test'
                )
              );
            if (action === 'reply')
              assert.equal(draft.body.draft.cc[0].email, 'noah@northstar.test');
          }
        );
        const handle = await editor.elementHandle();
        await editor.pressSequentially(' Saved without replacing the editor.', {
          delay: 20,
        });
        await saved(t, 'Saved without replacing');
        await check(
          'Autosave keeps the same focused editor DOM node',
          async () => {
            assert.ok(
              await handle.evaluate(
                (el) => el.isConnected && el === document.activeElement
              )
            );
          }
        );
        await card
          .getByRole('button', { name: 'Delete draft', exact: true })
          .click();
        await check(
          'Reply draft is discarded without deleting the source message',
          async () => {
            await expect(editor).toHaveCount(0);
            await expect(card).toBeVisible();
          }
        );
      }
    );
  await scene(
    '09-send-undo',
    'Real local send queue, immediate cancellation and draft recovery',
    async (t) => {
      const { page, check, expect, writes, assert } = t;
      await start(t, 'Atlas review — send and undo');
      await saved(t, 'launch review is ready');
      await expect(
        page.getByRole('button', { name: 'Send', exact: true })
      ).toBeEnabled();
      await page.getByRole('button', { name: 'Send', exact: true }).click();
      await page
        .getByRole('button', { name: 'Undo', exact: true })
        .last()
        .click({ timeout: 10000 });
      await check(
        'The real send succeeded and Undo cancelled its scheduled delivery',
        async () => {
          await expect(
            page.getByText('Send cancelled', { exact: true })
          ).toBeVisible({ timeout: 20000 });
          assert.ok(
            writes.some(
              (r) => r.path.endsWith('/email/messages') && r.status === 201
            )
          );
          assert.ok(
            writes.some(
              (r) =>
                r.path.includes('/drafts/scheduled/') &&
                r.method === 'DELETE' &&
                r.status < 300
            )
          );
        }
      );
      await check('Undo restores editable content and recipients', async () => {
        await expect(
          page.locator('[contenteditable=true]').last()
        ).toContainText('The launch review is ready.');
        await expect(page.locator('[draggable=true]').first()).toBeVisible();
        await expect(
          page.getByRole('button', { name: 'Send', exact: true })
        ).toBeEnabled();
      });
    }
  );
  await scene(
    '10-schedule',
    'Schedule a future message, reload, and unschedule through the real backend',
    async (t) => {
      const { page, check, expect, writes, sleep, origin } = t;
      await start(t, 'Atlas review — scheduled follow-up');
      await saved(t, 'launch review is ready');
      const schedule = page.locator('button[aria-haspopup="listbox"]').last();
      await schedule.click();
      await sleep(300);
      await page
        .getByRole('option', { name: /Tomorrow/ })
        .first()
        .click();
      await page.keyboard.press('Escape');
      await check(
        'Future schedule persists and disables immediate send',
        async () => {
          await expect
            .poll(
              () =>
                writes.some(
                  (r) =>
                    r.path.includes('/drafts/scheduled/') &&
                    r.method === 'PUT' &&
                    r.status < 300
                ),
              { timeout: 20000 }
            )
            .toBe(true);
          await expect(
            page.getByRole('button', { name: 'Send', exact: true })
          ).toBeDisabled();
        }
      );
      const dateLabel = await page
        .locator('button[aria-haspopup="listbox"]')
        .last()
        .innerText();
      const draft = writes
        .filter((r) => r.path.endsWith('/email/drafts') && r.saved)
        .at(-1);
      await page.goto(origin + '/app/email/' + draft.saved.thread);
      await expect(
        page.getByRole('button', { name: 'Send', exact: true })
      ).toBeDisabled();
      await check('Scheduled draft survives a full reload', () =>
        expect(page.locator('body')).toContainText(dateLabel)
      );
      const date = page.locator('button[aria-haspopup="listbox"]').last();
      await date.locator('[tabindex="0"]').click();
      await check(
        'Clearing the date unschedules on the real backend and re-enables Send',
        async () => {
          await expect
            .poll(() =>
              writes.some(
                (r) =>
                  r.path.includes('/drafts/scheduled/') &&
                  r.method === 'DELETE' &&
                  r.status < 300
              )
            )
            .toBe(true);
          await expect(
            page.getByRole('button', { name: 'Send', exact: true })
          ).toBeEnabled();
        }
      );
    }
  );
};
module.exports.start = start;
module.exports.saved = saved;
