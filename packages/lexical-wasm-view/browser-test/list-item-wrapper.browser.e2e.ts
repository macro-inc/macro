import { expect, test } from '@playwright/test';
import { watchCompiledSourceDeps } from './list-item-wrapper-deps';
import type {} from './list-item-wrapper-fixture';

test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage();
  try {
    await page.goto('/browser-test/list-item-wrapper.html');
    await page.waitForFunction(() => Boolean(window.listItemWrapperProof));
    await page.evaluate(() => window.listItemWrapperClose?.());
  } finally {
    await page.close();
  }
});
test('nested task-list wrapper matches Source item roles and classes', async ({
  page,
}, info) => {
  const compiled = watchCompiledSourceDeps(page);
  try {
    await page.goto('/browser-test/list-item-wrapper.html');
    await page.waitForFunction(() => Boolean(window.listItemWrapperProof));
    const capture = await page.evaluate(() => {
      if (!window.listItemWrapperProof)
        throw new Error('Missing actual engines');
      return window.listItemWrapperProof.capture();
    });
    await info.attach('raw-list-item-dom.json', {
      body: JSON.stringify({ ...capture, compiled: await compiled() }),
      contentType: 'application/json',
    });
    expect(capture.errors).toEqual([]);
    expect(
      capture.source.rows.filter((row) => row.role === 'checkbox')
    ).toHaveLength(3);
    expect(capture.native.rows).toEqual(capture.source.rows);
  } finally {
    await page.evaluate(() => window.listItemWrapperClose?.());
  }
});
