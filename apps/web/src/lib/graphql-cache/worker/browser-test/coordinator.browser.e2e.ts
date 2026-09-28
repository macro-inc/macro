import { expect, test } from '@playwright/test';

const harnessPath = (projectName: string, path = ''): string =>
  projectName.includes('production') ? `/app/${path}` : `/${path}`;

test('three pages fence graceful, abrupt, stale, and worker-only ownership', async ({
  context,
  page,
}, testInfo) => {
  const browserErrors: string[] = [];
  const watch = (candidate: typeof page): void => {
    candidate.on('console', (message) => {
      if (message.type() === 'error') browserErrors.push(message.text());
    });
    candidate.on('pageerror', (error) => browserErrors.push(error.message));
  };
  watch(page);
  context.on('page', watch);

  await page.goto(harnessPath(testInfo.project.name));
  const result = page.locator('#result');
  await expect(result).toHaveAttribute('data-status', 'passed', {
    timeout: 40_000,
  });
  const report = JSON.parse((await result.textContent()) ?? '') as {
    passed: boolean;
    openedTabs: number;
    ownerEpochs: number[];
    maxWorkersPerEpoch: number;
    noEagerWorker: boolean;
    collidingRequestIdsRewritten: boolean;
    gracefulPreserved: boolean;
    abruptRejectedInflight: boolean;
    abruptWiped: boolean;
    workerOnlyPageStayedAlive: boolean;
    workerOnlyWiped: boolean;
    livenessPageStayedAlive: boolean;
    livenessTerminationReason: string;
    livenessWiped: boolean;
    staleMessageDrops: number;
    staleMessagePortResponseDropped: boolean;
    pushReachedAllTabs: boolean;
    ownerLockContentionEpochs: number[];
    engineReplacedEpochs: number[];
    protocolErrors: string[];
  };

  expect(report).toMatchObject({
    passed: true,
    openedTabs: 3,
    ownerEpochs: [1, 2, 3, 4],
    maxWorkersPerEpoch: 1,
    noEagerWorker: true,
    collidingRequestIdsRewritten: true,
    gracefulPreserved: true,
    abruptRejectedInflight: true,
    abruptWiped: true,
    workerOnlyPageStayedAlive: true,
    workerOnlyWiped: true,
    livenessPageStayedAlive: true,
    livenessTerminationReason: 'tab liveness lock was released',
    livenessWiped: true,
    staleMessageDrops: 1,
    staleMessagePortResponseDropped: true,
    pushReachedAllTabs: true,
    ownerLockContentionEpochs: [1, 2, 3, 4],
    engineReplacedEpochs: [2, 3, 4],
    replacementStorageOutcomes: [
      [2, 'opened-existing'],
      [3, 'reset-storage-uncertain'],
      [4, 'reset-storage-uncertain'],
    ],
    protocolErrors: [],
  });
  expect(browserErrors).toEqual([]);
});

test('production CacheHost performs fresh init and active reread after owner loss', async ({
  context,
  page,
}, testInfo) => {
  const browserErrors: string[] = [];
  const watch = (candidate: typeof page): void => {
    candidate.on('console', (message) => {
      if (message.type() === 'error') browserErrors.push(message.text());
    });
    candidate.on('pageerror', (error) => browserErrors.push(error.message));
  };
  watch(page);
  context.on('page', watch);

  await page.goto(harnessPath(testInfo.project.name, 'host.html'));
  const result = page.locator('#result');
  await expect(result).toHaveAttribute('data-status', 'passed', {
    timeout: 60_000,
  });
  const report = JSON.parse((await result.textContent()) ?? '') as {
    passed: boolean;
    noEagerConstructor: boolean;
    requestOrder: Array<[number, number, string]>;
    oldEpochRejectedBeforeReplacement: boolean;
    oldRequestReplayCount: number;
    replacementActiveKeys: number[][];
    replacementReadCompleted: boolean;
    gracefulDrained: boolean;
    terminatedEpochs: number[];
    sharedPortClosed: boolean;
    initializationErrors: string[];
  };

  expect(report).toEqual({
    passed: true,
    noEagerConstructor: true,
    requestOrder: [
      [1, 1, 'init'],
      [1, 2, 'read'],
      [1, 3, 'read'],
      [1, 4, 'read'],
      [2, 5, 'init'],
      [2, 6, 'read'],
    ],
    oldEpochRejectedBeforeReplacement: true,
    oldRequestReplayCount: 1,
    replacementStorage: ['reset'],
    replacementActiveKeys: [[7, 9]],
    replacementReadCompleted: true,
    gracefulDrained: true,
    terminatedEpochs: [1, 2],
    sharedPortClosed: true,
    initializationErrors: [],
  });
  expect(browserErrors).toEqual([]);
});

test('direct cutover lazily deletes only the former normalized-cache IDB', async ({
  page,
}, testInfo) => {
  const browserErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text());
  });
  page.on('pageerror', (error) => browserErrors.push(error.message));

  await page.goto(harnessPath(testInfo.project.name, 'cutover.html'));
  const result = page.locator('#result');
  await expect(result).toHaveAttribute('data-status', 'passed', {
    timeout: 60_000,
  });
  const report = JSON.parse((await result.textContent()) ?? '') as {
    passed: boolean;
    noEagerDeletion: boolean;
    deletionRequestedOnFirstUse: boolean;
    blockedDeletionDidNotBlockHost: boolean;
    legacyDeletionCompletedLater: boolean;
    unrelatedIdbPreserved: boolean;
  };

  expect(report).toEqual({
    passed: true,
    noEagerDeletion: true,
    deletionRequestedOnFirstUse: true,
    blockedDeletionDidNotBlockHost: true,
    legacyDeletionCompletedLater: true,
    unrelatedIdbPreserved: true,
  });
  expect(browserErrors).toEqual([]);
});

test('a suspended owner resumes without replacement or cache loss', async ({
  context,
  page,
  browserName,
}, testInfo) => {
  test.skip(
    browserName !== 'chromium',
    'CDP lifecycle control is Chromium-only'
  );
  const scope = `cache-suspension-${crypto.randomUUID()}`;
  const path = `${harnessPath(testInfo.project.name, 'cache-lifecycle.html')}?treatment=true&scope=${scope}`;
  await page.goto(path);
  await page.evaluate(async () => {
    await window.cacheLifecycleHarness.startSingle();
    await window.cacheLifecycleHarness.write('preserve-through-suspension');
  });
  const before = await page.evaluate(() => window.cacheLifecycleHarness.read());
  expect(before).toMatchObject({ kind: 'hit' });
  const follower = await context.newPage();
  await follower.goto(path);
  await follower.evaluate(() => window.cacheLifecycleHarness.startSingle());

  const cdp = await context.newCDPSession(page);
  const { targetInfos } = await cdp.send('Target.getTargets');
  const engine = targetInfos.find(
    (target) =>
      target.type === 'worker' && target.url.includes('cache.engine-worker')
  );
  if (!engine) throw new Error('missing cache engine target');
  const { sessionId } = await cdp.send('Target.attachToTarget', {
    targetId: engine.targetId,
    flatten: false,
  });
  const paused = new Promise<void>((resolve) => {
    cdp.on('Target.receivedMessageFromTarget', (event) => {
      if (
        event.sessionId === sessionId &&
        JSON.parse(event.message).method === 'Debugger.paused'
      )
        resolve();
    });
  });
  const debug = async (id: number, method: string) => {
    await cdp.send('Target.sendMessageToTarget', {
      sessionId,
      message: JSON.stringify({ id, method }),
    });
  };
  await debug(1, 'Debugger.enable');
  await debug(2, 'Debugger.pause');
  await paused;
  try {
    await cdp.send('Page.setWebLifecycleState', { state: 'frozen' });
    // CDP page freezing alone need not pause a lock-holding worker in Chrome.
    // Explicitly pause its event loop, keeping its lock held, while the other
    // page keeps the coordinator running beyond multiple heartbeat deadlines.
    await new Promise((resolve) => setTimeout(resolve, 16_000));
    const { targetInfos: suspendedTargets } =
      await cdp.send('Target.getTargets');
    expect(
      suspendedTargets.some((target) => target.targetId === engine.targetId)
    ).toBe(true);
  } finally {
    const { targetInfos: remainingTargets } =
      await cdp.send('Target.getTargets');
    if (
      remainingTargets.some((target) => target.targetId === engine.targetId)
    ) {
      await debug(3, 'Debugger.resume');
    }
    await cdp.send('Page.setWebLifecycleState', { state: 'active' });
    await cdp.detach();
  }

  expect(
    await page.evaluate(() => window.cacheLifecycleHarness.read())
  ).toEqual(before);
  expect(
    await page.evaluate(() => window.cacheLifecycleHarness.engineWorkerCount())
  ).toBe(1);
  expect(
    await follower.evaluate(() =>
      window.cacheLifecycleHarness.engineWorkerCount()
    )
  ).toBe(0);
  expect(
    await follower.evaluate(() => window.cacheLifecycleHarness.read())
  ).toEqual(before);
});

test('a silently terminated engine still recovers after releasing its owner lock', async ({
  page,
}, testInfo) => {
  await page.goto(
    `${harnessPath(testInfo.project.name, 'cache-lifecycle.html')}?treatment=true`
  );
  await page.evaluate(() => window.cacheLifecycleHarness.startSingle());
  const result = await page.evaluate(() =>
    window.cacheLifecycleHarness.abruptOwnerLoss()
  );
  expect(result).toMatchObject({
    oldRequestRejected: true,
    replacement: { kind: 'miss' },
  });
  expect(
    await page.evaluate(() => window.cacheLifecycleHarness.engineWorkerCount())
  ).toBe(2);
});

test('production cache-wasm Turso engine preserves graceful data and atomically recovers abrupt loss', async ({
  context,
  page,
}, testInfo) => {
  const browserErrors: string[] = [];
  const watch = (candidate: typeof page): void => {
    candidate.on('console', (message) => {
      if (message.type() === 'error') browserErrors.push(message.text());
    });
    candidate.on('pageerror', (error) => browserErrors.push(error.message));
  };
  watch(page);
  context.on('page', watch);

  await page.goto(harnessPath(testInfo.project.name, 'production.html'));
  const result = page.locator('#result');
  await expect(result).toHaveAttribute('data-status', 'passed', {
    timeout: 60_000,
  });
  const report = JSON.parse((await result.textContent()) ?? '') as {
    passed: boolean;
    realTursoDataPreservedGracefully: boolean;
    gracefulCloseReleasedOwnerLock: boolean;
    gracefulReplacementWaitedForPhysicalLock: boolean;
    gracefulPendingOwnerLockRequests: number;
    abruptInflightRejected: boolean;
    abruptRequestReplayCount: number;
    abruptOwnerPageStayedAlive: boolean;
    recoveryReplacementWaitedForPhysicalLock: boolean;
    recoveryPendingOwnerLockRequests: number;
    atomicRecoveryOpenWipedToMiss: boolean;
    recoveryDatabaseAction: string;
    ownerEpochs: number[];
    protocolErrors: string[];
  };

  expect(report).toEqual({
    passed: true,
    realTursoDataPreservedGracefully: true,
    gracefulCloseReleasedOwnerLock: true,
    gracefulReplacementWaitedForPhysicalLock: true,
    gracefulPendingOwnerLockRequests: 1,
    abruptInflightRejected: true,
    abruptRequestReplayCount: 1,
    abruptOwnerPageStayedAlive: true,
    recoveryReplacementWaitedForPhysicalLock: true,
    recoveryPendingOwnerLockRequests: 1,
    atomicRecoveryOpenWipedToMiss: true,
    recoveryDatabaseAction: 'wipe-before-open',
    ownerEpochs: [1, 2, 3],
    protocolErrors: [],
  });
  expect(browserErrors).toEqual([]);
});
