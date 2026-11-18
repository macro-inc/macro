import { expect, test } from '@playwright/test';
import type {} from './decorator-owner-fixture';

test('native decorator updates retain application providers across async mounts and clean up once', async ({
  page,
}) => {
  await page.goto('/browser-test/decorator-owner.html');
  await page.waitForFunction(() => Boolean(window.decoratorOwner));
  await page.evaluate(() => window.decoratorOwner.insert());
  await expect(page.locator('[data-decorator-context]')).toHaveText(
    'application context'
  );
  const attributes = await page
    .locator('[data-lexical-decorator]')
    .evaluate((element) => element.getAttributeNames());
  expect(attributes).toContain('contenteditable');
  expect(attributes.indexOf('data-lexical-decorator')).toBeLessThan(
    attributes.indexOf('contenteditable')
  );
  expect(await page.evaluate(() => window.decoratorOwner.clear())).toBe(1);
  await expect(page.locator('[data-decorator-context]')).toHaveCount(0);
  expect(await page.evaluate(() => window.decoratorOwner.close())).toBe(1);
});
