import { expect, test } from '@playwright/test';
import type {} from './selection-change-fixture';

test('six-operation own-DOM range ignores one interior selectionchange only', async ({
  page,
}, info) => {
  await page.goto('/browser-test/selection-change.html');
  await page.waitForFunction(() => Boolean(window.selectionChangeTape));
  const result = await page.evaluate(() => window.selectionChangeTape.run());
  await info.attach('native-selection-change-tape', {
    body: JSON.stringify(result, null, 2),
    contentType: 'application/json',
  });
  expect(result.first).toEqual(result.backward);
  expect(result.second).toEqual({
    ...result.backward,
    dirty: false,
    anchor: { ...result.backward.anchor, offset: 6 },
    focus: { ...result.backward.focus, offset: 8 },
  });
  expect(result.dom).toEqual({ anchor: 6, focus: 8 });
  expect(await page.evaluate(() => window.selectionChangeTape.errors)).toEqual(
    []
  );
});
