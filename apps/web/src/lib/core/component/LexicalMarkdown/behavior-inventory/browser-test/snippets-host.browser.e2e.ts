import { writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { installBrowserHooks } from './browser-hooks';

test.afterEach(async ({ page }) => {
  if (await page.locator('.menu-surface').count())
    await page.keyboard.press('Escape');
});
installBrowserHooks('/snippets.html');

for (const mode of ['keyboard', 'pointer'] as const) {
  test(`Source snippet ${mode} choice preserves cached insertion and raw stages`, async ({
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
    await page.keyboard.type(';');
    const choice = page
      .locator('.menu-surface')
      .getByText('Reusable example', { exact: true });
    await expect(choice).toBeVisible();
    await expect(
      page
        .locator('.menu-surface')
        .getByText('Current document', { exact: true })
    ).toHaveCount(0);
    await expect(
      page
        .locator('.menu-surface')
        .getByText('Alternative template', { exact: true })
    ).toBeVisible();
    await capture('open');
    await page.keyboard.type('Reus');
    await expect(choice).toBeVisible();
    await expect(body).toHaveText(';Reus');
    await expect(
      page
        .locator('.menu-surface')
        .getByText('Alternative template', { exact: true })
    ).toHaveCount(0);
    await capture('query');
    if (mode === 'keyboard') await page.keyboard.press('Enter');
    else if (hasTouch) await choice.tap();
    else await choice.click();
    await expect(page.locator('.menu-surface')).toHaveCount(0);
    await expect(body.locator('strong')).toHaveText('Cached snippet');
    await capture('inserted');
    await page.keyboard.type(' tail');
    await expect(body).toHaveText('Cached snippet tail');
    const raw = JSON.stringify(captures, null, 2);
    await info.attach('raw-snippet-controller-stages', {
      body: raw,
      contentType: 'application/json',
    });
    if (process.env.OVERLAY_SNIPPET_CAPTURE) {
      writeFileSync(
        `${process.env.OVERLAY_SNIPPET_CAPTURE}/${info.project.name}-${mode}.json`,
        raw
      );
    }
  });
}

test('Source snippet Escape preserves the literal query and typing caret', async ({
  page,
}) => {
  const body = page.getByRole('textbox', { name: 'Body', exact: true });
  await body.click();
  await page.keyboard.type(';Reus');
  await expect(
    page.locator('.menu-surface').getByText('Reusable example', { exact: true })
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.menu-surface')).toHaveCount(0);
  await expect(body).toHaveText(';Reus');
  await expect(
    page
      .locator('.menu-surface')
      .getByText('Alternative template', { exact: true })
  ).toHaveCount(0);
  await page.keyboard.type(' after');
  await expect(body).toHaveText(';Reus after');
});
