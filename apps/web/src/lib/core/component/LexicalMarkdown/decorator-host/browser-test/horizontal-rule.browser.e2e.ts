import { expect, test } from '@playwright/test';

test('actual native horizontal-rule component selects, deletes and retains its sibling', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(
    '/src/lib/core/component/LexicalMarkdown/decorator-host/browser-test/horizontal-rule.html'
  );
  const root = page.getByRole('textbox', {
    name: 'Native horizontal-rule fixture',
  });
  await expect(root.locator('.h-10')).toHaveCount(2);
  await root.locator('.h-10').first().click();
  await expect
    .poll(() =>
      page.evaluate(
        () => window.horizontalRuleFixture.snapshot().selection.kind
      )
    )
    .toBe('node');
  await root.locator('.h-10').first().getByRole('button').click();
  await expect(root.locator('.h-10')).toHaveCount(1);
  const survivor = await page.evaluate(
    () => window.horizontalRuleFixture.snapshot().keys?.[0]
  );
  expect(survivor).toBeDefined();
  await page.evaluate(() => window.horizontalRuleFixture.deselect());
  await expect
    .poll(() =>
      page.evaluate(
        () => window.horizontalRuleFixture.snapshot().selection.kind
      )
    )
    .toBe('none');
  await root.locator('.h-10').click();
  await expect
    .poll(() =>
      page.evaluate(() => window.horizontalRuleFixture.snapshot().selection)
    )
    .toEqual({ kind: 'node', keys: [survivor] });
  const snapshot = await page.evaluate(() =>
    window.horizontalRuleFixture.snapshot()
  );
  expect(snapshot.types).toEqual(['horizontalrule', 'paragraph']);
  expect(snapshot.bindingCount).toBe(2);
  expect(snapshot.errors).toEqual([]);
  expect(errors).toEqual([]);
  await testInfo.attach('native-horizontal-rule.json', {
    body: JSON.stringify(snapshot),
    contentType: 'application/json',
  });
  await page.evaluate(() => window.horizontalRuleFixture.close());
});
