import { expect, test } from '@playwright/test';

test('native commit work stays flat with comments, tables and code', async ({
  page,
}, testInfo) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto('/browser-test/index.html');
  await expect(page.locator('#editor')).toHaveText('a');
  const results = [];
  for (const size of [8, 128]) {
    const result = await page.evaluate(
      (size) => window.fixture.commitWork(size),
      size
    );
    results.push(result);
    expect(result.replacementLast).toBeCloseTo(result.replacementActual);
    expect(result.rebound).toBe(true);
    expect(result.reboundTop).toBeCloseTo(result.reboundActual);
    expect(result.commentReads).toBe(1);
    expect(result.commentTop).toBeCloseTo(result.actualTop);
    expect(result.tableWrites).toBe(0);
    expect(result.selectionIntact).toBe(true);
    expect(result.retained).toBe(true);
    expect(result.movedLast).toBeCloseTo(result.actualLast);
    expect(result.shiftedReads).toBe(size);
    expect(result.empty).toBe(false);
  }
  expect(results[1].codeRangeInputs).toBe(results[0].codeRangeInputs);
  expect(results[0].codeRangeInputs).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.fixture.errors)).toEqual([]);
  expect(pageErrors).toEqual([]);
  await testInfo.attach('native-commit-work.json', {
    body: JSON.stringify(results, null, 2),
    contentType: 'application/json',
  });
});
