import { readdirSync, readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

for (const file of readdirSync(new URL('./fixtures', import.meta.url)).filter(
  (file) => file.endsWith('.json')
)) {
  const fixture = JSON.parse(
    readFileSync(new URL(`./fixtures/${file}`, import.meta.url), 'utf8')
  ) as { name: string; container_widths?: number[] };
  for (const theme of ['light', 'dark']) {
    for (const width of fixture.container_widths ?? [600]) {
      test(`${fixture.name} ${theme} ${width}`, async ({ page }) => {
        const errors: string[] = [];
        const remote: string[] = [];
        page.on('pageerror', (error) => errors.push(error.message));
        page.on('request', (request) => {
          if (!request.url().startsWith('http://127.0.0.1:24821'))
            remote.push(request.url());
        });
        await page.goto(
          `/?fixture=${fixture.name}&theme=${theme}&width=${width}`
        );
        await page.evaluate(() => document.fonts.ready);
        await expect(page.locator('#email-host')).toHaveScreenshot(
          `${fixture.name}-${theme}-${width}.png`
        );
        expect(errors).toEqual([]);
        expect(remote).toEqual([]);
      });
    }
  }
}
