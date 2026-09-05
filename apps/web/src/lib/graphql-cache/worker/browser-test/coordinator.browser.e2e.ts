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
