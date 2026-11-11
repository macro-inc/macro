import { writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { installBrowserHooks } from './browser-hooks';

test.afterEach(async ({ page }) => {
  if (await page.locator('.menu-surface').count())
    await page.keyboard.press('Escape');
});
installBrowserHooks();

for (const mode of ['keyboard', 'enclosed'] as const) {
  test(`capture exact emoji ${mode} controller DOM and JSON`, async ({
    page,
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
    await page.keyboard.type(':');
    const menu = page.locator('.menu-surface');
    await expect(menu.locator('.group').first()).toBeVisible();
    await capture('open');
    await page.keyboard.type('rocket');
    await expect(menu.getByText('rocket', { exact: true })).toBeVisible();
    await capture('query');
    await page.keyboard.press(mode === 'keyboard' ? 'Enter' : ':');
    await expect(menu).toHaveCount(0);
    await expect(body).toHaveText('🚀');
    await capture('inserted');
    const raw = JSON.stringify(captures, null, 2);
    await info.attach('raw-emoji-controller-stages', {
      body: raw,
      contentType: 'application/json',
    });
    if (process.env.OVERLAY_EMOJI_CAPTURE) {
      writeFileSync(
        `${process.env.OVERLAY_EMOJI_CAPTURE}/${info.project.name}-${mode}.json`,
        raw
      );
    }
  });
}
