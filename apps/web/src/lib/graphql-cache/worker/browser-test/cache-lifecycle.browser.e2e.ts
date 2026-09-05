import { basename } from 'node:path';
import { expect, test } from '@playwright/test';

const harnessPath = (projectName: string): string =>
  projectName.includes('production')
    ? '/app/cache-lifecycle.html'
    : '/cache-lifecycle.html';

const isHit = (value: unknown): boolean =>
  typeof value === 'object' &&
  value !== null &&
  (value as { kind?: unknown }).kind === 'hit';

const isMiss = (value: unknown): boolean =>
  typeof value === 'object' &&
  value !== null &&
  (value as { kind?: unknown }).kind === 'miss';

test.describe.configure({ mode: 'serial' });

const cacheResources = (urls: string[]) => ({
  wasm: [
    ...new Set(
      urls.filter((url) => /cache_wasm_bg(?:-[\w-]+)?\.wasm(?:\?|$)/.test(url))
    ),
  ],
  engine: [
    ...new Set(urls.filter((url) => /cache\.engine-worker[^/]*\.js/.test(url))),
  ],
  coordinator: [
    ...new Set(
      urls.filter((url) =>
        /cache\.coordinator\.shared-worker[^/]*\.js/.test(url)
      )
    ),
  ],
});

test('Cache exact host stays navigation-lazy, preserves offline handoff, resets identity, and wipes abrupt loss', async ({
  context,
  page,
}, testInfo) => {
  const requestedUrls: string[] = [];
  const browserErrors: string[] = [];
  const failedResponses: string[] = [];
  const failedRequests: string[] = [];
  context.on('request', (request) => requestedUrls.push(request.url()));
  context.on('requestfailed', (request) => {
    failedRequests.push(
      `${request.failure()?.errorText ?? 'failed'} ${request.url()}`
    );
  });
  context.on('response', (response) => {
    if (response.status() >= 400) {
      failedResponses.push(`${response.status()} ${response.url()}`);
    }
  });
  page.on('console', (message) => {
    if (message.type() === 'error') {
      browserErrors.push(
        `${message.text()} @ ${message.location().url || 'unknown'}`
      );
    }
  });
  page.on('pageerror', (error) => browserErrors.push(error.message));

  const path = harnessPath(testInfo.project.name);
  await page.goto(path);
  await expect(page.locator('#result')).toHaveAttribute('data-status', 'ready');
  await expect(page.locator('#result')).toHaveAttribute(
    'data-rollout',
    'control'
  );
  expect(
    await page.evaluate(() => ({
      mode: window.cacheLifecycleHarness.rolloutMode(),
      hostCount: window.cacheLifecycleHarness.hostConstructionCount(),
      workerCount: window.cacheLifecycleHarness.constructedWorkerUrls().length,
    }))
  ).toEqual({ mode: 'control', hostCount: 0, workerCount: 0 });
  expect(cacheResources(requestedUrls)).toEqual({
    wasm: [],
    engine: [],
    coordinator: [],
  });

  const scope = `cache-lifecycle-playwright-${crypto.randomUUID()}`;
  await page.goto(`${path}?treatment=true&scope=${encodeURIComponent(scope)}`);
  await expect(page.locator('#result')).toHaveAttribute('data-status', 'ready');
  await expect(page.locator('#result')).toHaveAttribute(
    'data-rollout',
    'treatment'
  );
  expect(
    await page.evaluate(() =>
      window.cacheLifecycleHarness.hostConstructionCount()
    )
  ).toBe(0);
  const beforeFirstUse = cacheResources([
    ...requestedUrls,
    ...(await page.evaluate(() =>
      window.cacheLifecycleHarness.constructedWorkerUrls()
    )),
  ]);
  expect(beforeFirstUse.wasm).toEqual([]);
  expect(beforeFirstUse.engine).toEqual([]);
  expect(beforeFirstUse.coordinator).toEqual([]);

  await page.evaluate(() => window.cacheLifecycleHarness.start());
  await expect
    .poll(() => cacheResources(requestedUrls).wasm.length, { timeout: 30_000 })
    .toBe(1);
  const afterFirstUse = cacheResources([
    ...requestedUrls,
    ...(await page.evaluate(() =>
      window.cacheLifecycleHarness.constructedWorkerUrls()
    )),
  ]);
  expect(afterFirstUse.engine).toHaveLength(1);
  expect(afterFirstUse.coordinator).toHaveLength(1);

  await page.evaluate(() =>
    window.cacheLifecycleHarness.write(
      'offline-preserved',
      'cache-lifecycle-offline-user'
    )
  );
  const standbyClose = await page.evaluate(() =>
    window.cacheLifecycleHarness.closeSamePageStandbyHost()
  );
  expect(isHit(standbyClose.ownerRead)).toBe(true);
  expect(standbyClose.engineWorkerCount).toBe(1);
  await page.evaluate(() => window.cacheLifecycleHarness.startStandby());
  await context.setOffline(true);
  const offlineHandoff = await page.evaluate(() =>
    window.cacheLifecycleHarness.cleanOwnerHandoff()
  );
  expect(isHit(offlineHandoff)).toBe(true);
  await context.setOffline(false);

  const identity = await page.evaluate(() =>
    window.cacheLifecycleHarness.identityReset()
  );
  expect(isMiss(identity.old)).toBe(true);
  expect(isHit(identity.current)).toBe(true);

  const abrupt = await page.evaluate(() =>
    window.cacheLifecycleHarness.abruptOwnerLoss()
  );
  expect(abrupt.oldRequestRejected).toBe(true);
  expect(isMiss(abrupt.replacement)).toBe(true);

  const isolation = await page.evaluate(() => ({
    crossOriginIsolated: globalThis.crossOriginIsolated,
    sharedArrayBufferCreated:
      typeof globalThis.SharedArrayBuffer === 'function' &&
      globalThis.crossOriginIsolated,
  }));
  expect(isolation).toEqual({
    crossOriginIsolated: false,
    sharedArrayBufferCreated: false,
  });
  expect({ browserErrors, failedResponses, failedRequests }).toEqual({
    browserErrors: [],
    failedResponses: [],
    failedRequests: [],
  });

  const resources = cacheResources([
    ...requestedUrls,
    ...(await page.evaluate(() =>
      window.cacheLifecycleHarness.constructedWorkerUrls()
    )),
  ]);
  const mode = testInfo.project.name.includes('production')
    ? 'production'
    : 'development';
  if (mode === 'production') {
    expect(resources.wasm).toHaveLength(1);
    expect(basename(new URL(resources.wasm[0]!).pathname)).toMatch(
      /^cache_wasm_bg-[\w-]+\.wasm$/
    );
    expect(resources.engine.every((url) => url.includes('/app/'))).toBe(true);
    expect(resources.coordinator.every((url) => url.includes('/app/'))).toBe(
      true
    );
  }

  await page.evaluate(() => window.cacheLifecycleHarness.dispose());
});

test('Cache normal offline reload reopens the existing OPFS cache', async ({
  context,
  page,
  request,
}, testInfo) => {
  const scope = `cache-lifecycle-offline-reload-${crypto.randomUUID()}`;
  const path = harnessPath(testInfo.project.name);
  await page.goto(`${path}?treatment=true&scope=${encodeURIComponent(scope)}`);
  await expect(page.locator('#result')).toHaveAttribute('data-status', 'ready');
  await page.evaluate(() => window.cacheLifecycleHarness.startSingle());
  await page.evaluate(() =>
    window.cacheLifecycleHarness.write(
      'offline-reload-preserved',
      'cache-lifecycle-offline-reload-user'
    )
  );
  expect(
    isHit(await page.evaluate(() => window.cacheLifecycleHarness.read()))
  ).toBe(true);

  // Keep only the already-known test app shell reachable while Chromium's
  // browser context is offline. Any product API request remains unavailable.
  const origin = new URL(page.url()).origin;
  await context.route(`${origin}/**`, async (route) => {
    const browserRequest = route.request();
    if (browserRequest.method() !== 'GET') {
      await route.abort('internetdisconnected');
      return;
    }
    const response = await request.get(browserRequest.url(), {
      headers: browserRequest.headers(),
    });
    await route.fulfill({ response });
  });
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('#result')).toHaveAttribute('data-status', 'ready');

  await page.evaluate(() => window.cacheLifecycleHarness.startSingle());
  const reloaded = await page.evaluate(() =>
    window.cacheLifecycleHarness.read()
  );
  expect(isHit(reloaded)).toBe(true);

  await context.setOffline(false);
  await page.evaluate(() => window.cacheLifecycleHarness.dispose());
});

test('Cache real standby tab close preserves the same active engine', async ({
  context,
  page,
}, testInfo) => {
  test.skip(
    !testInfo.project.name.includes('production'),
    'Cache rollout evidence requires the production bundle'
  );
  const scope = `cache-lifecycle-standby-tab-${crypto.randomUUID()}`;
  const path = `${harnessPath(testInfo.project.name)}?treatment=true&scope=${encodeURIComponent(scope)}`;
  await page.goto(path);
  await expect(page.locator('#result')).toHaveAttribute('data-status', 'ready');
  await page.evaluate(() => window.cacheLifecycleHarness.startSingle());
  expect(
    await page.evaluate(() => window.cacheLifecycleHarness.engineWorkerCount())
  ).toBe(1);
  const ownerWorkerUrls = await page.evaluate(() =>
    window.cacheLifecycleHarness.constructedWorkerUrls()
  );
  await page.evaluate(() =>
    window.cacheLifecycleHarness.write('real-standby-preserved')
  );

  const standbyPage = await context.newPage();
  await standbyPage.goto(path);
  await expect(standbyPage.locator('#result')).toHaveAttribute(
    'data-status',
    'ready'
  );
  await standbyPage.evaluate(() => window.cacheLifecycleHarness.startSingle());
  expect(
    await standbyPage.evaluate(() =>
      window.cacheLifecycleHarness.engineWorkerCount()
    )
  ).toBe(0);
  expect(
    await standbyPage.evaluate(() => window.cacheLifecycleHarness.read())
  ).toMatchObject({
    kind: 'hit',
    data: {
      user: {
        soup: { items: [{ id: 'real-standby-preserved' }] },
      },
    },
  });

  await standbyPage.close();
  await page.evaluate(() =>
    window.cacheLifecycleHarness.write('owner-after-real-standby-close')
  );
  expect(
    await page.evaluate(() => window.cacheLifecycleHarness.read())
  ).toMatchObject({
    kind: 'hit',
    data: {
      user: {
        soup: { items: [{ id: 'owner-after-real-standby-close' }] },
      },
    },
  });
  expect(
    await page.evaluate(() => window.cacheLifecycleHarness.engineWorkerCount())
  ).toBe(1);
  expect(
    await page.evaluate(() =>
      window.cacheLifecycleHarness.constructedWorkerUrls()
    )
  ).toEqual(ownerWorkerUrls);
  await page.evaluate(() => window.cacheLifecycleHarness.dispose());
});

test('Cache actual logout cache lifecycle wipes the registered production host', async ({
  page,
}, testInfo) => {
  test.skip(
    !testInfo.project.name.includes('production'),
    'Cache rollout evidence requires the production bundle'
  );
  const scope = `cache-lifecycle-logout-${crypto.randomUUID()}`;
  const path = `${harnessPath(testInfo.project.name)}?treatment=true&scope=${encodeURIComponent(scope)}`;
  await page.goto(path);
  await expect(page.locator('#result')).toHaveAttribute('data-status', 'ready');
  await page.evaluate(() => window.cacheLifecycleHarness.startLogoutHost());
  await page.evaluate(() =>
    window.cacheLifecycleHarness.write('logout-must-wipe')
  );
  expect(
    isHit(await page.evaluate(() => window.cacheLifecycleHarness.read()))
  ).toBe(true);
  expect(
    isMiss(
      await page.evaluate(() => window.cacheLifecycleHarness.logoutReset())
    )
  ).toBe(true);
  await page.evaluate(() => window.cacheLifecycleHarness.write('post-logout'));
  expect(
    isHit(await page.evaluate(() => window.cacheLifecycleHarness.read()))
  ).toBe(true);
  await page.evaluate(() => window.cacheLifecycleHarness.dispose());
});

test('Cache actual GraphQL Soup selector stays default-off without browser cache resources', async ({
  page,
}, testInfo) => {
  test.skip(
    !testInfo.project.name.includes('production'),
    'Cache rollout evidence requires the production bundle'
  );
  const requestedUrls: string[] = [];
  page.on('request', (request) => requestedUrls.push(request.url()));
  await page.goto(
    testInfo.project.name.includes('production')
      ? '/app/graphql-soup-rollout.html'
      : '/graphql-soup-rollout.html'
  );
  await expect(page.locator('#result')).toHaveAttribute('data-status', 'ready');
  const result = await page.evaluate(() =>
    window.graphqlSoupRolloutHarness.resolveDefaultOff()
  );
  expect(result).toEqual({
    cacheEnabled: false,
    cacheHostPresent: false,
    resources: { workerUrls: [], sharedWorkerUrls: [] },
  });
  expect(cacheResources(requestedUrls)).toEqual({
    wasm: [],
    engine: [],
    coordinator: [],
  });
});

test('Cache actual PostHog treatment override is lazy and kill applies on navigation', async ({
  page,
}, testInfo) => {
  test.skip(
    !testInfo.project.name.includes('production'),
    'Cache rollout evidence requires the production bundle'
  );
  const requestedUrls: string[] = [];
  page.on('request', (request) => requestedUrls.push(request.url()));
  const posthogRequests = () =>
    requestedUrls.filter((url) => {
      const parsed = new URL(url);
      return (
        parsed.hostname.includes('posthog') ||
        parsed.pathname.includes('/__cache-rollout-posthog-disabled') ||
        parsed.pathname.includes('/i/ph/')
      );
    });
  const path = '/app/graphql-soup-rollout.html';
  await page.goto(path);
  await expect(page.locator('#result')).toHaveAttribute('data-status', 'ready');
  const treatment = await page.evaluate(() =>
    window.graphqlSoupRolloutHarness.tryTreatment()
  );
  expect(
    treatment.overrideApplied,
    'the required supported PostHog override must be available'
  ).toBe(true);
  if (!treatment.overrideApplied) {
    throw new Error('required PostHog treatment override was unavailable');
  }

  expect(treatment.lazyBeforeRead).toBe(true);
  expect(treatment.readKind).toBe('miss');
  expect(treatment.samePageKillLatched).toBe(true);
  expect(treatment.posthogBeforeSendCalls).toBe(0);
  expect(treatment.resources.workerUrls).toHaveLength(1);
  expect(treatment.resources.workerUrls[0]).toMatch(
    /cache\.engine-worker-[A-Za-z0-9_-]+\.js$/
  );
  expect(treatment.resources.sharedWorkerUrls).toHaveLength(1);
  expect(treatment.resources.sharedWorkerUrls[0]).toMatch(
    /cache\.coordinator\.shared-worker-[A-Za-z0-9_-]+\.js$/
  );
  expect(cacheResources(requestedUrls).wasm).toHaveLength(1);
  expect(posthogRequests()).toEqual([]);

  const requestCountBeforeNavigation = requestedUrls.length;
  await page.goto(path);
  await expect(page.locator('#result')).toHaveAttribute('data-status', 'ready');
  const afterNavigation = await page.evaluate(() =>
    window.graphqlSoupRolloutHarness.resolveAfterNavigationKill()
  );
  expect(afterNavigation).toEqual({
    cacheEnabled: false,
    cacheHostPresent: false,
    posthogBeforeSendCalls: 0,
    resources: { workerUrls: [], sharedWorkerUrls: [] },
  });
  expect(
    cacheResources(requestedUrls.slice(requestCountBeforeNavigation))
  ).toEqual({ wasm: [], engine: [], coordinator: [] });
  expect(posthogRequests()).toEqual([]);
});

test('Cache terminates each admitted mutating RPC before core without replay', async ({
  context,
  page,
}, testInfo) => {
  test.skip(
    !testInfo.project.name.includes('production'),
    'Cache fault evidence requires the production bundle'
  );
  testInfo.setTimeout(360_000);
  const requestedUrls: string[] = [];
  context.on('request', (request) => requestedUrls.push(request.url()));
  await page.goto('/app/cache-recovery.html');
  await expect(page.locator('#result')).toHaveAttribute('data-status', 'ready');
  const kinds = await page.evaluate(
    () => window.cacheRecoveryHarness.mutatingRequestKinds
  );
  expect(kinds).toEqual([
    'write',
    'enqueue-optimistic-mutation',
    'claim-next-mutation',
    'defer-optimistic-write',
    'commit-optimistic-write',
    'rollback-optimistic-write',
    'invalidate',
    'delete-records',
    'clear',
  ]);
  const results = [];
  for (const kind of kinds) {
    results.push(
      await page.evaluate(
        async (requestKind) =>
          await window.cacheRecoveryHarness.runFaultKind(requestKind),
        kind
      )
    );
  }
  for (const result of results) {
    expect(result).toMatchObject({
      actualDedicatedWorkerTerminated: true,
      requestAdmittedBeforeCore: true,
      midSqlExecutionClaimed: false,
      oldRequestRejected: true,
      replacementRecordsEmpty: true,
      replacementQueueEmpty: true,
      mutationAdmissionCount: 1,
      unexpectedReplacementMutatingAdmissionCount: 0,
      replacementAdmissionBarrierObserved: true,
      resetPhaseSequence: [
        'graphql_cache.storage_reset_required',
        'graphql_cache.logical_reset',
        'graphql_cache.reset_wipe',
      ],
      exactProductionTursoWasm: true,
      queueTelemetryObserved: true,
      performanceMemoryAvailable: false,
      userAgentSpecificMemoryAvailable: false,
    });
  }
  expect(cacheResources(requestedUrls).wasm).toHaveLength(1);
  expect(cacheResources(requestedUrls).engine).toHaveLength(1);
});

test('Cache lock-safe incompatible namespace and corrupt queue payload recover exactly once', async ({
  context,
  page,
}, testInfo) => {
  test.skip(
    !testInfo.project.name.includes('production'),
    'Cache recovery evidence requires the production bundle'
  );
  testInfo.setTimeout(180_000);
  const requestedUrls: string[] = [];
  context.on('request', (request) => requestedUrls.push(request.url()));
  await page.goto('/app/cache-recovery.html');
  await expect(page.locator('#result')).toHaveAttribute('data-status', 'ready');
  const recoveryHookUrls = new Set<string>();
  for (const [kind, openOutcome] of [
    ['incompatible-namespace', 'reset-incompatible'],
    ['corrupt-queue-payload', 'reset-corrupt'],
  ] as const) {
    const result = await page.evaluate(
      async (recoveryKind) =>
        await window.cacheRecoveryHarness.runRecoveryKind(recoveryKind),
      kind
    );
    expect(result).toMatchObject({
      kind,
      gracefulCloseBeforeMutation: true,
      separateFeatureGatedBrowserTestArtifact: true,
      productionArtifactDebugExportsAbsent: true,
      browserTestWasmUrl: expect.stringMatching(
        /cache_wasm_browser_test_hooks_bg-[A-Za-z0-9_-]+\.wasm$/
      ),
      browserTestWorkerOnlyControl: true,
      productionCoordinatorProtocolUnchanged: true,
      openOutcome,
      recordsWiped: true,
      durableQueueWiped: true,
      usableAfterReset: true,
      storageResetRequiredCount: 1,
      logicalResetCount: 1,
      resetWipeCount: 1,
      queueTelemetryObserved: true,
    });
    recoveryHookUrls.add(result.browserTestWasmUrl);
  }
  expect(recoveryHookUrls.size).toBe(1);
  const [recoveryHookUrl] = [...recoveryHookUrls];
  if (!recoveryHookUrl) throw new Error('missing recovery-hook WASM URL');
  const hookResponse = await context.request.get(recoveryHookUrl);
  expect(hookResponse.ok()).toBe(true);
  expect(cacheResources(requestedUrls).wasm).toHaveLength(1);
  expect(cacheResources(requestedUrls).engine).toHaveLength(1);
});

test('Cache Chromium storage eviction reopens empty without fabricated Firefox coverage', async ({
  context,
  page,
}, testInfo) => {
  test.skip(
    !testInfo.project.name.startsWith('chromium'),
    'Chromium CDP is the only local storage-eviction control available'
  );
  const path = harnessPath(testInfo.project.name);
  const scope = `cache-lifecycle-eviction-${crypto.randomUUID()}`;
  await page.goto(`${path}?treatment=true&scope=${encodeURIComponent(scope)}`);
  await expect(page.locator('#result')).toHaveAttribute('data-status', 'ready');
  await page.evaluate(async () => {
    await window.cacheLifecycleHarness.start();
    await window.cacheLifecycleHarness.write(
      'evict-me',
      'cache-lifecycle-eviction-user'
    );
    window.cacheLifecycleHarness.dispose();
  });
  await page.waitForTimeout(1_000);

  const cdp = await context.newCDPSession(page);
  await cdp.send('Storage.clearDataForOrigin', {
    origin: new URL(page.url()).origin,
    storageTypes: 'file_systems',
  });
  const reopened = await page.evaluate(async () => {
    await window.cacheLifecycleHarness.start();
    return await window.cacheLifecycleHarness.read();
  });
  expect(isMiss(reopened)).toBe(true);
  await page.evaluate(() => window.cacheLifecycleHarness.dispose());
});
