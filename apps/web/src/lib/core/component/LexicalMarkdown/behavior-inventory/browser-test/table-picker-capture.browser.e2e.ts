import { writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { installBrowserHooks } from './browser-hooks';

installBrowserHooks();
test('capture exact table picker controller DOM and JSON', async ({
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
  await page.keyboard.type('/table');
  const menu = page.locator('.menu-surface');
  await expect(menu.getByText('Table', { exact: true })).toBeVisible();
  await expect(menu.getByText('Normal Text', { exact: true })).toHaveCount(0);
  await page.keyboard.press('Enter');
  await expect(menu.locator('p')).toHaveText('3 × 3');
  await expect(body).toBeFocused();
  await capture('open');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowRight');
  await expect(menu.locator('p')).toHaveText('4 × 4');
  await capture('resized');
  await page.keyboard.press('Enter');
  await expect(menu).toHaveCount(0);
  await expect(body.locator('td')).toHaveCount(16);
  await expect(body).toBeFocused();
  await capture('inserted');
  const raw = JSON.stringify(captures, null, 2);
  await info.attach('raw-table-picker-stages', {
    body: raw,
    contentType: 'application/json',
  });
  if (process.env.OVERLAY_TABLE_CAPTURE) {
    writeFileSync(
      `${process.env.OVERLAY_TABLE_CAPTURE}/${info.project.name}.json`,
      raw
    );
  }
});
