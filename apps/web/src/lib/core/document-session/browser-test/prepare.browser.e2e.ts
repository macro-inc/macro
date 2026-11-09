import { expect, test } from '@playwright/test';

const fixture = '/src/lib/core/document-session/browser-test/index.html';

test('real paste preparation waits for shell paint and idle before editor readiness', async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.requestIdleCallback = (callback) => {
      document.addEventListener(
        'fixture-release-idle',
        () => callback({ didTimeout: false, timeRemaining: () => 10 }),
        { once: true }
      );
      document.documentElement.dataset.fixtureIdlePending = 'true';
      return 1;
    };
  });
  await page.route('**/document_session_wasm.js', async (route) => {
    const response = await route.fetch();
    const original = await response.text();
    const declaration = 'export function prepareMacroPaste() {';
    expect(original).toContain(declaration);
    await route.fulfill({
      response,
      body: original.replace(
        declaration,
        `${declaration}\nperformance.mark('fixture.prepare-paste');`
      ),
    });
  });
  await page.goto(fixture);
  await expect(page.getByText('Application shell ready')).toBeVisible();
  await expect(page.getByText('Loading editor engine')).toBeVisible();
  await expect(page.getByText('Editor subtree ready')).toHaveCount(0);
  await expect(page.locator('html')).toHaveAttribute(
    'data-fixture-idle-pending',
    'true'
  );
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const observer = new PerformanceObserver((list) => {
          if (
            list
              .getEntries()
              .some((entry) => entry.name === 'first-contentful-paint')
          ) {
            observer.disconnect();
            resolve();
          }
        });
        observer.observe({ type: 'paint', buffered: true });
      })
  );
  expect(
    await page.evaluate(
      () => performance.getEntriesByName('fixture.prepare-paste').length
    )
  ).toBe(0);
  await page.evaluate(() =>
    document.dispatchEvent(new Event('fixture-release-idle'))
  );
  await expect(page.getByText('Editor subtree ready')).toBeVisible();
  const times = await page.evaluate(() => ({
    paint: performance.getEntriesByName('first-contentful-paint')[0]?.startTime,
    preparation: performance
      .getEntriesByName('fixture.prepare-paste')
      .map((entry) => entry.startTime),
  }));
  expect(times.preparation).toHaveLength(1);
  expect(times.paint).toBeLessThan(times.preparation[0]);
});
