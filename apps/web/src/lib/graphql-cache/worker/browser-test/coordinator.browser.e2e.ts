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
    livenessPreserved: boolean;
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
    livenessPreserved: true,
    staleMessageDrops: 1,
    staleMessagePortResponseDropped: true,
    pushReachedAllTabs: true,
    ownerLockContentionEpochs: [1, 2, 3, 4],
    engineReplacedEpochs: [2, 3, 4],
    replacementStorageOutcomes: [
      [2, 'opened-existing'],
      [3, 'reset-storage-uncertain'],
      [4, 'opened-existing'],
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

test('an owner page that dies while writes arrive leaves every accepted write queued', async ({
  context,
  page,
}, testInfo) => {
  const path = `${harnessPath(testInfo.project.name, 'cache-lifecycle.html')}?treatment=true&scope=${crypto.randomUUID()}`;
  const open = async (target: typeof page): Promise<typeof page> => {
    // The development server reloads a page whose dependencies it just bundled.
    await expect(async () => {
      await target.goto(path);
      await target.evaluate(() => window.cacheLifecycleHarness.startSingle());
    }).toPass();
    return target;
  };
  const crash = async (target: typeof page): Promise<void> => {
    const devtools = await context.newCDPSession(target);
    // A crashed page never answers the command, so only the event is awaited.
    const crashed = target.waitForEvent('crash');
    devtools.send('Page.crash').catch(() => undefined);
    await crashed;
  };
  const runsEngine = (target: typeof page) => target.workers().length > 0;
  let owner = await open(page);
  const everAccepted: string[] = [];
  for (const killAfterMs of [0, 0, 20, 60, 150]) {
    const writer = await open(await context.newPage());
    const generation = await writer.evaluate(() =>
      window.cacheLifecycleHarness.storageGeneration()
    );
    const refusals = writer.evaluate(() =>
      window.cacheLifecycleHarness.queueWrites()
    );
    const accepted = () =>
      writer.evaluate(() => window.cacheLifecycleHarness.acceptedWriteCount());
    await expect.poll(accepted).toBeGreaterThan(3);
    await writer.waitForTimeout(killAfterMs);
    expect([runsEngine(owner), runsEngine(writer)]).toEqual([true, false]);
    // The first page's process also runs the coordinator, which a crash ends.
    // Playwright crashes Chromium only.
    if (testInfo.project.name.includes('firefox')) await owner.close();
    else await crash(owner);
    const before = await accepted();
    await expect
      .poll(accepted, { timeout: 20_000 })
      .toBeGreaterThan(before + 3);
    await writer.evaluate(() => window.cacheLifecycleHarness.stopQueueing());

    // At most the one in flight, whose outcome only the dead engine knew.
    expect([[], ['admitted-enqueue-uncertain']]).toContainEqual(await refusals);
    everAccepted.push(
      ...(await writer.evaluate(() =>
        window.cacheLifecycleHarness.acceptedWrites()
      ))
    );
    const queued = new Set(
      await writer.evaluate(() => window.cacheLifecycleHarness.queuedWrites())
    );
    expect(everAccepted.filter((uuid) => !queued.has(uuid))).toEqual([]);
    expect(
      await writer.evaluate(() =>
        window.cacheLifecycleHarness.storageGeneration()
      )
    ).toBe(generation);
    owner = writer;
  }
});

test('pages left by the crash of the one that started the coordinator get their cache back', async ({
  context,
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name.includes('firefox'),
    'Playwright crashes Chromium only'
  );
  const path = `${harnessPath(testInfo.project.name, 'cache-lifecycle.html')}?treatment=true&scope=${crypto.randomUUID()}`;
  const open = async (target: typeof page): Promise<typeof page> => {
    await expect(async () => {
      await target.goto(path);
      await target.evaluate(() => window.cacheLifecycleHarness.startSingle());
    }).toPass();
    return target;
  };
  const first = await open(page);
  const left = [
    await open(await context.newPage()),
    await open(await context.newPage()),
  ];
  const generation = await first.evaluate(() =>
    window.cacheLifecycleHarness.storageGeneration()
  );
  const devtools = await context.newCDPSession(first);
  const crashed = first.waitForEvent('crash');
  devtools.send('Page.crash').catch(() => undefined);
  await crashed;

  for (const target of left) {
    await expect
      .poll(
        () =>
          target.evaluate(() =>
            window.cacheLifecycleHarness.read().then(
              (answer) => answer,
              () => 'refused'
            )
          ),
        { timeout: 20_000 }
      )
      .toEqual({ kind: 'miss' });
    expect(
      await target.evaluate(() =>
        window.cacheLifecycleHarness.storageGeneration()
      )
    ).toBe(generation);
  }
  expect(left.flatMap((target) => target.workers())).toHaveLength(1);
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
    gracefulQueuedOwnerLockRequests: number;
    gracefulRetriedHeldOwnerLock: boolean;
    abruptInflightRejected: boolean;
    abruptRequestReplayCount: number;
    abruptOwnerPageStayedAlive: boolean;
    recoveryReplacementWaitedForPhysicalLock: boolean;
    recoveryQueuedOwnerLockRequests: number;
    recoveryRetriedHeldOwnerLock: boolean;
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
    gracefulQueuedOwnerLockRequests: 0,
    gracefulRetriedHeldOwnerLock: true,
    abruptInflightRejected: true,
    abruptRequestReplayCount: 1,
    abruptOwnerPageStayedAlive: true,
    recoveryReplacementWaitedForPhysicalLock: true,
    recoveryQueuedOwnerLockRequests: 0,
    recoveryRetriedHeldOwnerLock: true,
    atomicRecoveryOpenWipedToMiss: true,
    recoveryDatabaseAction: 'wipe-before-open',
    ownerEpochs: [1, 2, 3],
    protocolErrors: [],
  });
  expect(browserErrors).toEqual([]);
});

test('production engine waits out a departing owner that still holds the files, and never wipes them', async ({
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

  await page.goto(harnessPath(testInfo.project.name, 'production-busy.html'));
  const result = page.locator('#result');
  await expect(result).toHaveAttribute('data-status', 'passed', {
    timeout: 80_000,
  });
  const report = JSON.parse((await result.textContent()) ?? '') as Record<
    string,
    unknown
  >;

  expect(report).toEqual({
    passed: true,
    firstReplacementDatabaseAction: 'open-existing',
    firstReplacementWaitedForFiles: true,
    firstReplacementKeptData: true,
    firstRecoveryAttempts: 0,
    busyReplacementDatabaseAction: 'open-existing',
    busyReplacementOpened: false,
    busyReplacementTerminated: true,
    survivorToldFilesAreOpen: true,
    survivorReadFellBack: true,
    retriedWhileBusy: false,
    laterTabDatabaseAction: 'open-existing',
    laterTabKeptData: true,
    protocolErrors: [],
  });
  expect(browserErrors).toEqual([]);
});

test('a newer build with the same coordinator URL takes the production database over', async ({
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

  await page.goto(
    harnessPath(testInfo.project.name, 'production-takeover.html')
  );
  const result = page.locator('#result');
  await expect(result).toHaveAttribute('data-status', 'passed', {
    timeout: 80_000,
  });
  const report = JSON.parse((await result.textContent()) ?? '') as Record<
    string,
    unknown
  >;

  expect(report).toEqual({
    passed: true,
    newBuildDatabaseAction: 'open-existing',
    newBuildKeptData: true,
    oldEngineStoppedLikeNavigation: true,
    oldTabsSentOn: true,
    olderBuildTurnedAway: true,
    olderBuildSentOn: false,
    lateOldTabRunsUncached: true,
    lateOldTabSentOn: false,
    newBuildSentOn: false,
    protocolErrors: [],
  });
  expect(browserErrors).toEqual([]);
});
