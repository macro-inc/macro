import { expect, test } from '@playwright/test';
import type {} from './normal-enter-fixture';

test('trusted Enter interleaves Normal listeners and publishes after pending reads', async ({
  page,
}, info) => {
  await page.goto('/browser-test/normal-enter.html');
  await page.waitForFunction(() => Boolean(window.normalEnter));
  for (const engine of ['source', 'native'] as const) {
    await page.evaluate(() => window.normalEnter.reset());
    await page.locator(`#${engine}`).click();
    await page.keyboard.press('End');
    await page.keyboard.press('Control+Enter');
    const snapshot = await page.evaluate(
      (engine) => window.normalEnter.snapshot(engine),
      engine
    );
    await info.attach(engine, {
      body: JSON.stringify(snapshot),
      contentType: 'application/json',
    });
    expect(snapshot.trace).toEqual([
      'first:Enter',
      'pending:draft!',
      'published:draft',
      'last',
    ]);
    expect(snapshot.text).toBe('draft!');
    expect(snapshot.errors).toEqual([]);
  }
});

test('programmatic Enter supplies null and preserves the same final raw JSON', async ({
  page,
}, info) => {
  await page.goto('/browser-test/normal-enter.html');
  await page.waitForFunction(() => Boolean(window.normalEnter));
  await page.evaluate(() => window.normalEnter.reset());
  const snapshots = [];
  for (const engine of ['source', 'native'] as const) {
    await page.evaluate(
      (engine) => window.normalEnter.programmatic(engine),
      engine
    );
    const snapshot = await page.evaluate(
      (engine) => window.normalEnter.snapshot(engine),
      engine
    );
    await info.attach(engine, {
      body: JSON.stringify(snapshot),
      contentType: 'application/json',
    });
    expect(snapshot.trace).toEqual([
      'first:null',
      'pending:draft!',
      'published:draft',
      'last',
    ]);
    expect(snapshot.text).toBe('draft!');
    expect(snapshot.errors).toEqual([]);
    snapshots.push(snapshot.json);
  }
  expect(snapshots[1]).toBe(snapshots[0]);
});
