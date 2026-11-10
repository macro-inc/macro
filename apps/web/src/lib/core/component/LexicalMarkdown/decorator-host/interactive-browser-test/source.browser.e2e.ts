import { expect, test } from '@playwright/test';

for (const kind of ['snapshot', 'paste']) {
  test(`actual Source ${kind} rendering and selected state`, async ({
    page,
  }, info) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('**/__macro_dev/gateway/**', (route) => route.abort());
    await page.goto(
      `/src/lib/core/component/LexicalMarkdown/decorator-host/interactive-browser-test/fixture.html?kind=${kind}`
    );
    const root = page.getByRole('textbox', { name: 'Interactive decorators' });
    await expect(root).toContainText(
      kind === 'paste' ? '**Held** paste text' : 'No Access'
    );
    await expect
      .poll(() => page.evaluate(() => !!window.interactiveSourceFixture))
      .toBe(true);
    const initial = await page.evaluate(() =>
      window.interactiveSourceFixture!.capture()
    );
    await page.evaluate(() => window.interactiveSourceFixture!.select());
    await expect(
      root.locator(kind === 'paste' ? '.outline-4' : '.bg-active.text-ink')
    ).toBeVisible();
    const selected = await page.evaluate(() =>
      window.interactiveSourceFixture!.capture()
    );
    expect(selected.model).toBe(initial.model);
    await info.attach(`${kind}-initial.json`, {
      body: JSON.stringify(initial),
      contentType: 'application/json',
    });
    await info.attach(`${kind}-selected.json`, {
      body: JSON.stringify(selected),
      contentType: 'application/json',
    });
    expect(errors).toEqual([]);
  });
}

test('actual Source Snapshot Enter reads published selection after earlier pending mutation', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/__macro_dev/gateway/**', (route) => route.abort());
  await page.goto(
    '/src/lib/core/component/LexicalMarkdown/decorator-host/interactive-browser-test/fixture.html?kind=snapshot'
  );
  const root = page.getByRole('textbox', { name: 'Interactive decorators' });
  await expect(root).toContainText('No Access');
  await page.evaluate(() => window.interactiveSourceFixture!.select());
  await expect(root.locator('.bg-active.text-ink')).toBeVisible();
  const result = await page.evaluate(() =>
    window.interactiveSourceFixture!.enterAfterPendingRange()
  );
  expect(result).toEqual({
    handled: true,
    publishedNodeDuringEarlier: true,
    pendingRangeDuringEarlier: true,
    laterCalls: 0,
  });
  await info.attach('snapshot-enter-timing.json', {
    body: JSON.stringify(result),
    contentType: 'application/json',
  });
  expect(errors).toEqual([]);
});
