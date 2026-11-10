import { writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { installBrowserHooks } from './browser-hooks';

test.afterEach(async ({ page }) => {
  if (await page.locator('.menu-surface').count())
    await page.keyboard.press('Escape');
});
installBrowserHooks('/mentions.html');

for (const mode of ['keyboard', 'pointer'] as const) {
  test(`Source mention ${mode} choice retains raw controller and model stages`, async ({
    page,
    hasTouch,
  }, info) => {
    const captures: unknown[] = [];
    async function capture(stage: string) {
      captures.push(
        await page.evaluate(
          (stage) => ({
            stage,
            model: document.querySelector('#live-state')?.textContent,
            body: document.querySelector('#body')?.outerHTML,
            menus: Array.from(document.querySelectorAll('.menu-surface')).map(
              (element) => element.outerHTML
            ),
          }),
          stage
        )
      );
    }
    const body = page.getByRole('textbox', { name: 'Body', exact: true });
    await body.click();
    await page.keyboard.type('@');
    const choice = page
      .locator('.menu-surface')
      .locator('[title="Example User fixture@example.com"]');
    await expect(choice).toBeVisible();
    await expect(
      page
        .locator('.menu-surface')
        .locator('[title="Other Person other@example.com"]')
    ).toBeVisible();
    await capture('open');
    await page.keyboard.type('User');
    await expect(
      page
        .locator('.menu-surface')
        .locator('[title="Other Person other@example.com"]')
    ).toHaveCount(0);
    await capture('query');
    if (mode === 'keyboard') await page.keyboard.press('Enter');
    else if (hasTouch) await choice.tap();
    else await choice.click();
    await expect(page.locator('.menu-surface')).toHaveCount(0);
    await expect(body.locator('[data-user-mention]')).toHaveAttribute(
      'data-user-id',
      'macro|fixture@example.com'
    );
    await expect(page.locator('#live-state')).toContainText(
      '"type":"user-mention"'
    );
    await capture('inserted');
    const raw = JSON.stringify(captures, null, 2);
    await info.attach('raw-mention-controller-stages', {
      body: raw,
      contentType: 'application/json',
    });
    if (process.env.OVERLAY_MENTION_CAPTURE) {
      writeFileSync(
        `${process.env.OVERLAY_MENTION_CAPTURE}/${info.project.name}-${mode}.json`,
        raw
      );
    }
  });
}

test('Source mention Escape preserves literal query text and body typing', async ({
  page,
}) => {
  const body = page.getByRole('textbox', { name: 'Body', exact: true });
  await body.click();
  await page.keyboard.type('@Ex');
  await expect(
    page
      .locator('.menu-surface')
      .locator('[title="Example User fixture@example.com"]')
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.menu-surface')).toHaveCount(0);
  await expect(body).toHaveText('@Ex');
  await page.keyboard.type(' after');
  await expect(body).toHaveText('@Ex after');
});
