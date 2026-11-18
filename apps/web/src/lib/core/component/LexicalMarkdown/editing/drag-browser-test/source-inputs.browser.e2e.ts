import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { installBrowserHooks } from './browser-hooks';

installBrowserHooks('/?drag');
for (const [kind, label] of [
  ['paragraph', 'Load drag blocks'],
  ['list', 'Load drag list'],
] as const) {
  test(`freeze actual Source ${kind} input`, async ({ page }) => {
    await page.getByRole('button', { name: label, exact: true }).click();
    await expect(page.locator('#body')).toContainText(
      kind === 'paragraph' ? 'Alpha block' : 'First item'
    );
    await page.getByRole('button', { name: 'Save state', exact: true }).click();
    const data = JSON.parse(await page.locator('#saved').innerText());
    const out = process.env.DRAG_SOURCE_INPUTS;
    if (!out) throw new Error('Source input capture path required');
    await mkdir(out, { recursive: true });
    await writeFile(
      resolve(out, kind + '.json'),
      JSON.stringify(data.state) + '\n'
    );
  });
}
