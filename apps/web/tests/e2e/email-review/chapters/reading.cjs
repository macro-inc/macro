module.exports = async (scene) => {
  await scene(
    '01-inboxes',
    'Signal, Noise, Sent, Drafts, All and account filters',
    async ({ page, check, expect, sleep }) => {
      for (const [tab, text] of [
        ['Signal', 'Atlas launch'],
        ['Noise', 'Northstar Weekly'],
        ['Sent', 'Sent: agenda approved'],
        ['Drafts', 'launch follow-up'],
        ['All', 'Atlas'],
      ]) {
        await page.getByText(tab, { exact: true }).last().click();
        await check(`${tab} shows the expected seeded email`, () =>
          expect(page.locator('body')).toContainText(text, { timeout: 20000 })
        );
      }
      await page.getByText('All inboxes', { exact: true }).last().click();
      await sleep(500);
      const studio = page
        .getByRole('option')
        .filter({ hasText: 'studio@northstar.test' });
      await studio.hover();
      await studio.getByText('Only', { exact: true }).click();
      await page.keyboard.press('Escape');
      await check(
        'Selecting only the studio inbox filters the list',
        async () => {
          await expect(page.locator('body')).toContainText(
            'Studio inbox — client brief'
          );
          await expect(
            page.getByText(
              'Invitation: Atlas launch review — Thursday 7–9 PM',
              { exact: true }
            )
          ).toHaveCount(0);
        }
      );
    }
  );
  await scene(
    '02-thread-navigation',
    'Chronology, saved draft association, details, keyboard movement and quotes',
    async ({ page, visit, check, expect, manifest, assert, sleep }) => {
      await visit('work:launch');
      await check(
        'Eight messages stay chronological; saved draft is attached to message four',
        async () => {
          assert.deepEqual(
            await page
              .locator('[data-message-body-id]')
              .evaluateAll((es) => es.map((e) => e.dataset.messageBodyId)),
            manifest.launchMessages
          );
          await expect(
            page.locator(
              `[data-message-body-id="${manifest.launchMessages[3]}"] [contenteditable=true]`
            )
          ).toContainText('Ready to send the final agenda.');
        }
      );
      const first = page.locator('[data-message-body-id]').first();
      await first.click({ position: { x: 300, y: 15 } });
      await page.mouse.move(5, 5);
      await check('Collapsed message expands to its HTML body', () =>
        expect(
          first.getByText('design and timing', { exact: true })
        ).toBeVisible()
      );
      await first.hover();
      await first.locator('button').first().click();
      await check('Message details reveal sender and recipients', () =>
        expect(first.getByText('From', { exact: true })).toBeVisible()
      );
      await first.locator('button').first().click();
      await page.mouse.move(5, 5);
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Enter');
      await check(
        'ArrowDown and Enter select and expand the next message',
        () =>
          expect(
            page
              .locator('[data-message-body-id]')
              .nth(1)
              .locator('.ph-no-capture')
              .first()
          ).toBeVisible()
      );
      await page.keyboard.press('ArrowUp');
      await page.keyboard.press('Escape');
      const second = page.locator('[data-message-body-id]').nth(1);
      await second.click({ position: { x: 300, y: 15 } });
      await sleep(500);
      await second.locator('.ph-no-capture button').last().click();
      await check('Quoted history can be revealed', () =>
        expect(
          second.getByText(
            'Earlier discussion: keep the launch simple, accessible, and reliable.',
            { exact: true }
          )
        ).toBeVisible()
      );
    }
  );
  await scene(
    '03-paging-deep-links',
    'Real 120-message conversation; load older pages and reveal a target outside the first page',
    async ({ page, visit, check, expect, manifest, result, assert }) => {
      const target = manifest['long-historyMessages'][9];
      await visit('work:long-history', `?email_message_id=${target}`);
      const card = page.locator(`[data-message-body-id="${target}"]`);
      await check(
        'A deep link fetches older server pages and expands message 010',
        async () => {
          await expect(card).toBeVisible({ timeout: 60000 });
          await expect(card).toContainText('Design review message 010');
          assert.ok(
            result.responses.some(
              (r) => r.path.includes('offset=') && !r.path.includes('offset=0&')
            )
          );
        }
      );
      await check('Deep-linked card is in the viewport', async () => {
        const b = await card.boundingBox();
        assert.ok(b.y < 1000 && b.y + b.height > 0);
      });
    }
  );
  for (const dark of [false, true])
    await scene(
      `04-rendering-${dark ? 'dark' : 'light'}`,
      'Calendar invitations, response banners, personal HTML, newsletters, Markdown and wide tables',
      async ({ page, visit, check, expect, assert }) => {
        for (const key of [
          'calendar-invite',
          'calendar-response',
          'personal',
          'newsletter',
          'plain',
          'macro',
          'wide-table',
        ]) {
          await visit('work:' + key);
          await page.mouse.move(5, 5);
          const card = page.locator('[data-message-body-id]').last();
          await check(
            `${key}: visible body without loading placeholder or horizontal page overflow`,
            async () => {
              await expect(card.locator('.ph-no-capture').first()).toBeVisible({
                timeout: 20000,
              });
              const loading = card.getByText('Loading messages', {
                exact: true,
              });
              if (await loading.count())
                await expect(loading.locator('../..')).toHaveCSS(
                  'opacity',
                  '0'
                );
              assert.ok(
                await page.evaluate(
                  () => document.documentElement.scrollWidth <= innerWidth
                )
              );
            }
          );
          if (key.startsWith('calendar')) {
            const metrics = await card.evaluate((card, dark) => {
              const root = [...card.querySelectorAll('*')].find(
                (n) => n.shadowRoot
              )?.shadowRoot;
              if (!root) throw new Error('Missing email shadow root');
              const context = document.createElement('canvas').getContext('2d');
              const rgb = (color) => {
                context.clearRect(0, 0, 1, 1);
                context.fillStyle = color;
                context.fillRect(0, 0, 1, 1);
                return [...context.getImageData(0, 0, 1, 1).data];
              };
              const light = (rgba) => {
                const v = rgba.slice(0, 3).map((c) => {
                  c /= 255;
                  return c <= 0.04045
                    ? c / 12.92
                    : ((c + 0.055) / 1.055) ** 2.4;
                });
                return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
              };
              const when = [...root.querySelectorAll('*')].findLast(
                (e) =>
                  e.textContent.trim() === 'When' &&
                  e.getBoundingClientRect().height > 0
              );
              const a = [...root.querySelectorAll('a')].find((e) =>
                e.textContent.includes('View all guest info')
              );
              const probe = document.createElement('span');
              probe.style.color = 'var(--color-accent)';
              card.append(probe);
              const accent = rgb(getComputedStyle(probe).color);
              probe.remove();
              const bg = rgb(getComputedStyle(card).backgroundColor),
                fg = rgb(getComputedStyle(when).color);
              const contrast =
                (Math.max(light(bg), light(fg)) + 0.05) /
                (Math.min(light(bg), light(fg)) + 0.05);
              const banner = [...root.querySelectorAll('div')].find(
                (e) =>
                  e.textContent.trim() ===
                  'A guest has accepted this invitation.'
              );
              return {
                fg,
                bg,
                dark: matchMedia('(prefers-color-scheme: dark)').matches,
                contrast,
                link: rgb(getComputedStyle(a).color),
                accent,
                banner: banner
                  ? getComputedStyle(banner).backgroundColor
                  : null,
              };
            }, dark);
            await check(
              `${key}: readable text, theme links and no pale response banner`,
              async () => {
                assert.equal(metrics.dark, dark);
                assert.ok(metrics.contrast >= 3, JSON.stringify(metrics));
                assert.deepEqual(metrics.link, metrics.accent);
                if (key === 'calendar-response')
                  assert.equal(metrics.banner, 'rgba(0, 0, 0, 0)');
              }
            );
          }
          if (key === 'plain')
            await check(
              'Plaintext Markdown preserves bold and checklist content',
              async () => {
                const text = card.getByText('Release readiness', {
                  exact: true,
                });
                await expect(text).toBeVisible();
                assert.ok(
                  await text.evaluate(
                    (e) => Number(getComputedStyle(e).fontWeight) >= 600
                  )
                );
              }
            );
          if (key === 'macro')
            await check(
              'Macro Markdown preserves heading and file link',
              async () => {
                await expect(
                  card.getByRole('heading', { name: 'Launch decisions' })
                ).toBeVisible();
                await expect(
                  card.getByRole('link', { name: 'Atlas launch brief' })
                ).toBeVisible();
              }
            );
          await card.screenshot({
            path: `/tmp/email-exhaustive-review/artifacts/render-${key}-${dark ? 'dark' : 'light'}.png`,
          });
        }
      },
      { dark }
    );
  await scene(
    '05-mailto',
    'Email links open a composer with the recipient; subject/body/Cc are not supported by the existing handler',
    async ({ page, visit, check, expect }) => {
      await visit('work:links');
      await page
        .getByRole('link', { name: 'contact Noah about the review' })
        .click();
      await check(
        'Mailto opens compose with the correct recipient',
        async () => {
          await expect(
            page.getByPlaceholder('Subject', { exact: true })
          ).toBeVisible();
          await expect(page.locator('body')).toContainText(
            'noah@northstar.test'
          );
        }
      );
    }
  );
  await scene(
    '06-permissions',
    'A guest can read a shared email without acquiring reply or triage controls',
    async ({ page, visit, check, expect }) => {
      await visit('work:read-only');
      await check('Shared view-only thread loads for a different user', () =>
        expect(page.locator('body')).toContainText(
          'This thread is shared with the guest as view-only.'
        )
      );
      await check(
        'Reply, forward and editable composer are absent',
        async () => {
          await expect(page.locator('[contenteditable=true]')).toHaveCount(0);
          await expect(
            page.getByRole('button', { name: /^Reply|^Forward/ })
          ).toHaveCount(0);
        }
      );
    },
    { user: 'guest' }
  );
};
