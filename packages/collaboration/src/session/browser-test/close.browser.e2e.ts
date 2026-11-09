import { expect, test } from '@playwright/test';
import type {} from './fixture';

for (const mode of [
  'unstarted',
  'before-start',
  'after-start',
  'reentrant-start',
] as const) {
  test(`real editor Close terminates (${mode})`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/src/session/browser-test/index.html');
    const result = await page.evaluate(async (mode) => {
      const before = document.body.innerHTML;
      const result = await window.closeFixture(mode);
      return { ...result, unchangedDom: before === document.body.innerHTML };
    }, mode);
    expect(result).toEqual({
      replies: [0xffffffff],
      freed: true,
      idempotent: true,
      revocations: mode === 'unstarted' ? 0 : 1,
      unchangedDom: true,
    });
    expect(errors).toEqual([]);
  });
}
