import { writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { installBrowserHooks } from './browser-hooks';

installBrowserHooks();
test('capture exact link controller DOM and JSON', async ({ page }, info) => {
  const captures: unknown[] = [];
  async function capture(stage: string) {
    captures.push(
      await page.evaluate(
        (stage) => ({
          stage,
          model: document.querySelector('#live-state')?.textContent,
          body: document.querySelector('#body')?.outerHTML,
          menus: Array.from(document.querySelectorAll('.menu-surface')).map(
            (e) => e.outerHTML
          ),
        }),
        stage
      )
    );
  }
  const body = page.getByRole('textbox', { name: 'Body', exact: true });
  await body.click();
  await page.keyboard.type('/link');
  await expect(
    page.locator('.menu-surface').getByText('Link', { exact: true })
  ).toBeVisible();
  await expect(
    page.locator('.menu-surface').getByText('Normal Text', { exact: true })
  ).toHaveCount(0);
  await capture('slash');
  await page.keyboard.press('Enter');
  const url = page.getByPlaceholder('https://example.com', { exact: true });
  await expect(url).toBeVisible();
  await capture('create');
  await url.fill('https://example.com/original');
  await page
    .getByPlaceholder('Link text', { exact: true })
    .fill('Fixture link');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  const link = body.getByRole('link', { name: 'Fixture link', exact: true });
  await expect(link).toBeVisible();
  await expect(body).toBeFocused();
  await capture('inserted');
  await link.click();
  await expect(url).toHaveValue('https://example.com/original');
  await capture('edit');
  await url.fill('https://example.org/edited');
  await page.keyboard.press('Enter');
  await expect(link).toHaveAttribute('href', 'https://example.org/edited');
  await capture('updated');
  const raw = JSON.stringify(captures, null, 2);
  await info.attach('raw-editor-and-overlay-stages', {
    body: raw,
    contentType: 'application/json',
  });
  if (process.env.OVERLAY_CAPTURE) {
    writeFileSync(
      `${process.env.OVERLAY_CAPTURE}/${info.project.name}.json`,
      raw
    );
  }
});
