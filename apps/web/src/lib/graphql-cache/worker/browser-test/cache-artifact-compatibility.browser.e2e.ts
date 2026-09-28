import { expect, test } from '@playwright/test';

test('recovery preflight rejects stale helper metadata before opening or modifying OPFS', async ({
  context,
  page,
}) => {
  let intercepted = false;
  const engineRequests: string[] = [];
  context.on('request', (request) => {
    if (/cache\.engine-worker[^/]*\.js$/.test(request.url()))
      engineRequests.push(request.url());
  });
  await context.route(
    /cache_wasm_browser_test_hooks-[^/]+\.js$/,
    async (route) => {
      const response = await route.fetch();
      intercepted = true;
      // Emulate an old helper without checking an obsolete WASM binary into git.
      const body = `${await response.text()}\nconst originalBuildInfo = cacheBuildInfo;\ncacheBuildInfo = () => ({ ...originalBuildInfo(), formatVersion: 0 });\n`;
      await route.fulfill({ response, body });
    }
  );
  await page.goto('/app/cache-recovery.html');
  await expect(page.locator('#result')).toHaveAttribute('data-status', 'ready');
  const error = await page.evaluate(async () => {
    try {
      await window.cacheRecoveryHarness.runRecoveryKind(
        'incompatible-namespace'
      );
      return undefined;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  });
  expect(intercepted).toBe(true);
  expect(error).toContain('Cache recovery fixture WASM mismatch');
  expect(error).toContain('just build-cache-wasm-browser-production');
  expect(engineRequests).toEqual([]);
  expect(
    await page.evaluate(async () => {
      const root = await navigator.storage.getDirectory();
      const entries: string[] = [];
      for await (const name of root.keys()) entries.push(name);
      return entries;
    })
  ).toEqual([]);
});
