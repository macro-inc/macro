const resultNode = document.querySelector('#result');
const runButton = document.querySelector('#run');
const LOCK_NAME = 'graphql-cache-turso-opfs-spike-owner';
const LOCK_RECOVERY_DEADLINE_MS = 30_000;
let workerConstructionCount = 0;
let workerIdentity = 0;
let sequence = 0;
let pageUnhandledRuntimeFailureCount = 0;
let pageWasmEnvironmentTrapCount = 0;
let workerErrorEventCount = 0;
const workerRuntimeObservations = [];

function isWasmEnvironmentTrap(error) {
  return (
    error instanceof WebAssembly.RuntimeError ||
    /unreachable|wasm trap|not implemented on this platform|std::time::Instant::now/i.test(
      `${error?.name ?? ''}: ${error?.message ?? error}\n${error?.stack ?? ''}`
    )
  );
}

function controlledHarnessError(message) {
  return Object.assign(new Error(message), {
    wasmEnvironmentTrap: false,
    routeClassification: 'harness-control',
  });
}

addEventListener('error', (event) => {
  pageUnhandledRuntimeFailureCount += 1;
  if (isWasmEnvironmentTrap(event.error)) pageWasmEnvironmentTrapCount += 1;
});
addEventListener('unhandledrejection', (event) => {
  pageUnhandledRuntimeFailureCount += 1;
  if (isWasmEnvironmentTrap(event.reason)) pageWasmEnvironmentTrapCount += 1;
});

class ProbeWorker {
  constructor(routeClassification = 'production') {
    workerConstructionCount += 1;
    this.identity = ++workerIdentity;
    this.routeClassification = routeClassification;
    const workerUrl = new URL('./worker.js', import.meta.url);
    if (routeClassification === 'explicit-temp-negative') {
      workerUrl.searchParams.set('routeClassification', routeClassification);
    }
    this.worker = new Worker(workerUrl, { type: 'module' });
    this.pending = new Map();
    this.events = [];
    this.eventWaiters = [];
    this.worker.addEventListener('message', (event) => {
      const message = event.data;
      if (message.id !== undefined) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        clearTimeout(pending.timeout);
        const runtimeEvidence = message.ok
          ? message.result?.runtimeEvidence
          : message.runtimeEvidence;
        this.recordRuntimeEvidence(`rpc:${pending.command}`, runtimeEvidence);
        if (message.ok) {
          pending.resolve(message.result);
        } else {
          pending.reject(
            Object.assign(new Error(message.error.message), message.error, {
              runtimeEvidence,
            })
          );
        }
        return;
      }
      this.recordRuntimeEvidence(
        `event:${message.event ?? 'unknown'}`,
        message.runtimeEvidence
      );
      this.events.push(message);
      for (const waiter of [...this.eventWaiters]) {
        if (waiter.event === message.event && waiter.predicate(message)) {
          this.eventWaiters = this.eventWaiters.filter(
            (candidate) => candidate !== waiter
          );
          clearTimeout(waiter.timeout);
          waiter.resolve(message);
        }
      }
    });
    this.worker.addEventListener('error', (event) => {
      workerErrorEventCount += 1;
      const error = Object.assign(new Error(event.message || 'worker error'), {
        wasmEnvironmentTrap: isWasmEnvironmentTrap(
          event.error ?? event.message
        ),
        routeClassification: 'worker-error-event',
      });
      this.rejectAll(error);
    });
  }

  recordRuntimeEvidence(source, evidence) {
    if (!evidence) return;
    workerRuntimeObservations.push({
      workerIdentity: this.identity,
      source,
      ...evidence,
    });
  }

  call(command, payload = {}, timeoutMs = 60_000) {
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(
          controlledHarnessError(`${command} timed out after ${timeoutMs}ms`)
        );
      }, timeoutMs);
      this.pending.set(id, { command, resolve, reject, timeout });
      this.worker.postMessage({ id, command, payload });
    });
  }

  waitForEvent(event, predicate = () => true, timeoutMs = 30_000) {
    const existing = this.events.find(
      (message) => message.event === event && predicate(message)
    );
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const waiter = { event, predicate, resolve, reject, timeout: undefined };
      waiter.timeout = setTimeout(() => {
        this.eventWaiters = this.eventWaiters.filter(
          (candidate) => candidate !== waiter
        );
        reject(
          controlledHarnessError(
            `event ${event} timed out after ${timeoutMs}ms`
          )
        );
      }, timeoutMs);
      this.eventWaiters.push(waiter);
    });
  }

  rejectAll(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
    for (const waiter of this.eventWaiters) {
      clearTimeout(waiter.timeout);
      waiter.reject(error);
    }
    this.eventWaiters = [];
  }

  terminate() {
    this.worker.terminate();
    this.rejectAll(
      controlledHarnessError('worker terminated while RPC pending')
    );
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function collectRecordedErrors(value, path = 'report', records = []) {
  if (value === null || typeof value !== 'object') return records;
  if (typeof value.wasmEnvironmentTrap === 'boolean') {
    records.push({ path, ...value });
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      collectRecordedErrors(entry, `${path}[${index}]`, records)
    );
  } else {
    for (const [key, entry] of Object.entries(value)) {
      collectRecordedErrors(entry, `${path}.${key}`, records);
    }
  }
  return records;
}

function runtimeSafetySnapshot() {
  return {
    pageUnhandledRuntimeFailureCount,
    pageWasmEnvironmentTrapCount,
    workerErrorEventCount,
    workerRuntimeObservationCount: workerRuntimeObservations.length,
    maxProductionReachableWasmTrapCount: Math.max(
      0,
      ...workerRuntimeObservations.map(
        (evidence) => evidence.productionReachableWasmTrapCount ?? 0
      )
    ),
    maxExpectedNegativeWasmTrapCount: Math.max(
      0,
      ...workerRuntimeObservations.map(
        (evidence) => evidence.expectedNegativeWasmTrapCount ?? 0
      )
    ),
    maxUnhandledWorkerRuntimeFailureCount: Math.max(
      0,
      ...workerRuntimeObservations.map(
        (evidence) => evidence.unhandledRuntimeFailureCount ?? 0
      )
    ),
    workerRuntimeObservations: workerRuntimeObservations.map((evidence) => ({
      ...evidence,
    })),
  };
}

function assertHeadRuntimeSafety(report) {
  const recordedErrors = collectRecordedErrors(report);
  const expectedNegative = recordedErrors.filter(
    (error) => error.routeClassification === 'explicit-temp-negative'
  );
  const productionErrors = recordedErrors.filter(
    (error) => error.routeClassification !== 'explicit-temp-negative'
  );
  assert(
    expectedNegative.length === 1,
    'explicit-temp negative trap evidence was not unique'
  );
  assert(
    expectedNegative[0].wasmEnvironmentTrap,
    'explicit-temp negative route did not trap'
  );
  assert(
    productionErrors.every((error) => error.wasmEnvironmentTrap === false),
    'a recorded production/control error was a WASM environment trap'
  );
  assert(
    workerRuntimeObservations.length > 0,
    'worker runtime evidence was not recorded'
  );
  assert(
    workerRuntimeObservations.every(
      (evidence) =>
        evidence.productionReachableWasmTrapCount === 0 &&
        evidence.unhandledRuntimeFailureCount === 0 &&
        ['production', 'explicit-temp-negative'].includes(
          evidence.workerRouteClassification
        )
    ),
    'a worker path observed a production WASM trap, unhandled failure, or unknown route'
  );
  assert(
    workerRuntimeObservations
      .filter((evidence) => evidence.source === 'rpc:explicitTempNegativeProbe')
      .every(
        (evidence) =>
          evidence.workerRouteClassification === 'explicit-temp-negative'
      ) &&
      workerRuntimeObservations
        .filter(
          (evidence) =>
            evidence.workerRouteClassification === 'explicit-temp-negative'
        )
        .every((evidence) =>
          [
            'rpc:initOwner',
            'rpc:resetTransactionProbe',
            'rpc:explicitTempNegativeProbe',
          ].includes(evidence.source)
        ),
    'negative-only worker evidence crossed into an enumerated production route'
  );
  assert(
    pageUnhandledRuntimeFailureCount === 0,
    'page observed an unhandled runtime failure'
  );
  assert(
    pageWasmEnvironmentTrapCount === 0,
    'page observed a WASM environment trap'
  );
  assert(workerErrorEventCount === 0, 'page observed a worker error event');
  report.runtimeSafety = {
    ...runtimeSafetySnapshot(),
    recordedErrorCount: recordedErrors.length,
    recordedProductionOrControlErrorCount: productionErrors.length,
    allRecordedProductionOrControlErrorsNonTrap: true,
    expectedNegativeErrorCount: expectedNegative.length,
  };
}

const delay = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

async function acquireOwnerUntil({
  deadlineMs = 1_000,
  retryDelayMs = 100,
  routeClassification = 'production',
} = {}) {
  const startedAt = new Date().toISOString();
  const startedMonotonicMs = performance.now();
  const deadline = startedMonotonicMs + deadlineMs;
  let attempts = 0;
  let last;
  while (performance.now() <= deadline) {
    attempts += 1;
    const candidate = new ProbeWorker(routeClassification);
    const init = await candidate.call('initOwner', { lockName: LOCK_NAME });
    last = init;
    if (init.acquired) {
      return {
        worker: candidate,
        init,
        recovery: {
          attempts,
          deadlineMs,
          startedAt,
          acquiredAt: new Date().toISOString(),
          elapsedMs: performance.now() - startedMonotonicMs,
        },
      };
    }
    candidate.terminate();
    await delay(retryDelayMs);
  }
  throw new Error(
    `database Web Lock was unavailable through ${deadlineMs}ms deadline: ${JSON.stringify(last)}`
  );
}

async function recoverDatabaseUntil({
  deadlineMs = LOCK_RECOVERY_DEADLINE_MS,
  retryDelayMs = 100,
} = {}) {
  const startedAt = new Date().toISOString();
  const startedMonotonicMs = performance.now();
  const deadline = startedMonotonicMs + deadlineMs;
  let attempts = 0;
  let candidateTerminations = 0;
  let lastAttempt;

  while (performance.now() < deadline) {
    attempts += 1;
    const remainingMs = deadline - performance.now();
    const candidate = new ProbeWorker();
    try {
      lastAttempt = await candidate.call(
        'recoverAfterKill',
        { lockName: LOCK_NAME, remainingMs },
        Math.max(1, Math.floor(remainingMs))
      );
    } catch (error) {
      lastAttempt = {
        recovered: false,
        timedOut: /timed out/i.test(error.message),
        error,
      };
      if (!lastAttempt.timedOut) throw error;
    } finally {
      candidate.terminate();
      candidateTerminations += 1;
    }

    if (lastAttempt.recovered) {
      const elapsedMs = performance.now() - startedMonotonicMs;
      assert(
        elapsedMs <= deadlineMs,
        'full OPFS recovery completed after its deadline'
      );
      assert(
        candidateTerminations === attempts,
        'a recovery candidate was not terminated'
      );
      return {
        result: lastAttempt,
        recovery: {
          scope: 'web-lock+preopen+sql-count+close+removeEntry+recreate',
          attempts,
          candidateTerminations,
          unsuccessfulCandidateTerminations: attempts - 1,
          deadlineMs,
          startedAt,
          completedAt: new Date().toISOString(),
          elapsedMs,
          successfulAttemptRemainingMs: lastAttempt.remainingMs,
        },
      };
    }

    const delayRemainingMs = deadline - performance.now();
    if (delayRemainingMs > 0) {
      await delay(Math.min(retryDelayMs, delayRemainingMs));
    }
  }
  throw new Error(
    `full OPFS recovery failed through ${deadlineMs}ms deadline after ${attempts} terminated candidates: ${JSON.stringify(lastAttempt)}`
  );
}

async function exerciseTransactionMode(worker, mode, expectParentFailure) {
  await worker.call('resetTransactionProbe');
  try {
    const result = await worker.call('transactionMode', { mode }, 30_000);
    if (expectParentFailure) {
      throw new Error(`parent ${mode} unexpectedly succeeded`);
    }
    assert(result.value.mode === mode, `${mode} returned the wrong mode`);
    assert(result.value.committed_rows === 1, `${mode} commit was not durable`);
    assert(
      result.value.rollback_preserved,
      `${mode} rollback did not preserve the commit`
    );
    return { succeeded: true, result, error: null };
  } catch (error) {
    if (!expectParentFailure) throw error;
    const record = {
      name: error.name,
      message: error.message,
      stack: error.stack ?? null,
      wasmEnvironmentTrap: error.wasmEnvironmentTrap === true,
      routeClassification: error.routeClassification ?? 'production',
      runtimeEvidence: error.runtimeEvidence ?? null,
    };
    assert(
      record.wasmEnvironmentTrap,
      `parent ${mode} did not fail with a WASM trap`
    );
    assert(
      /std::time::Instant::now|not implemented on this platform/.test(
        record.stack ?? ''
      ),
      `parent ${mode} trap lost the Instant/platform cause`
    );
    assert(
      /ensure_temp_database|create_temp_database|open_file_with_flags/.test(
        record.stack ?? ''
      ),
      `parent ${mode} trap lost the temp-database cause`
    );
    return { succeeded: false, result: null, error: record };
  }
}

async function runProbe() {
  const workersBeforeFirstUse = workerConstructionCount;
  const expectParentFailure =
    new URL(location.href).searchParams.get('transactionExpectation') ===
    'parent-failure';
  const runPhase =
    new URL(location.href).searchParams.get('runPhase') ?? 'cold';
  const report = {
    startedAt: new Date().toISOString(),
    runPhase,
    transactionExpectation: expectParentFailure
      ? 'parent-failure'
      : 'head-success',
    workersBeforeFirstUse,
    page: {
      userAgent: navigator.userAgent,
      crossOriginIsolated,
      sharedArrayBufferVisible: typeof SharedArrayBuffer !== 'undefined',
    },
  };
  let liveWorkers = [];

  try {
    assert(
      workersBeforeFirstUse === 0,
      'DedicatedWorker was constructed before first use'
    );

    const capabilityOwner = await acquireOwnerUntil();
    liveWorkers.push(capabilityOwner.worker);
    report.capabilities = capabilityOwner.init.capabilities;
    assert(
      capabilityOwner.init.capabilities.dedicatedWorker,
      'engine did not run in a DedicatedWorker'
    );
    assert(
      capabilityOwner.init.capabilities.storageGetDirectory,
      'OPFS getDirectory is unavailable'
    );
    assert(
      capabilityOwner.init.capabilities.webLocks,
      'Web Locks is unavailable in DedicatedWorker'
    );
    assert(
      !capabilityOwner.init.capabilities.crossOriginIsolated,
      'test unexpectedly used cross-origin isolation'
    );
    assert(
      capabilityOwner.init.capabilities.nestedWorkerMonitorInstalled,
      'nested-worker monitor missing'
    );
    assert(
      capabilityOwner.init.capabilities.nestedWorkerConstructionCount === 0,
      'nested worker constructed'
    );

    report.transactionModes = {};
    for (const mode of ['immediate', 'exclusive']) {
      const transactionOwner =
        mode === 'immediate'
          ? capabilityOwner
          : await acquireOwnerUntil({ deadlineMs: 5_000 });
      if (transactionOwner !== capabilityOwner)
        liveWorkers.push(transactionOwner.worker);
      report.transactionModes[mode] = await exerciseTransactionMode(
        transactionOwner.worker,
        mode,
        expectParentFailure
      );
      if (!expectParentFailure) {
        const shutdown = await transactionOwner.worker.call('shutdown');
        report.transactionModes[mode].shutdown = shutdown;
        assert(
          shutdown.evidence.productionReachableWasmTrapCount === 0 &&
            shutdown.evidence.unhandledRuntimeFailureCount === 0,
          `${mode} worker observed a runtime trap/failure`
        );
      }
      transactionOwner.worker.terminate();
      liveWorkers = liveWorkers.filter(
        (worker) => worker !== transactionOwner.worker
      );
    }

    if (expectParentFailure) {
      report.differentialExpectedFailure =
        !report.transactionModes.immediate.succeeded &&
        !report.transactionModes.exclusive.succeeded;
      assert(
        report.differentialExpectedFailure,
        'parent differential did not reproduce both failures'
      );
      report.workerConstructionCount = workerConstructionCount;
      report.runtimeSafety = runtimeSafetySnapshot();
      report.pass = true;
      return report;
    }

    const first = await acquireOwnerUntil({ deadlineMs: 5_000 });
    liveWorkers.push(first.worker);
    if (runPhase === 'warm') {
      report.warmStartPersistence = await first.worker.call('sqlRead');
      assert(
        report.warmStartPersistence.value.value === 'recovered-fresh',
        "warm run did not observe the prior run's clean persisted marker"
      );
    }
    report.initialReset = await first.worker.call('resetDatabase');
    report.directFile = await first.worker.call('directFile');
    const direct = report.directFile.operations;
    for (const field of [
      'empty_write_callbacks',
      'write_callbacks',
      'partial_write_callbacks',
      'read_callbacks',
      'short_read_callbacks',
      'eof_callbacks',
      'detected_short_read_callbacks',
      'zero_write_callbacks',
      'error_write_callbacks',
      'quota_write_callbacks',
    ]) {
      assert(direct[field] === 1, `${field} was not exactly one`);
    }
    assert(
      direct.empty_write_bytes === 0,
      'empty pwrite did not complete as zero bytes'
    );
    assert(direct.partial_write_retried, 'partial pwrite was not retried');
    assert(
      direct.short_read_bytes === 2 && direct.eof_bytes === 0,
      'short/EOF read mismatch'
    );
    assert(
      direct.zero_write_error === 'ShortWrite',
      'zero write did not become ShortWrite'
    );
    assert(
      direct.error_preserved && direct.quota_preserved,
      'specific write error was lost'
    );

    report.fullCacheSql = await first.worker.call('fullCacheSql', {}, 60_000);
    const cacheSql = report.fullCacheSql.value;
    for (const field of [
      'begin_immediate',
      'begin_exclusive',
      'ddl_rollback',
      'bound_text_blob_integer_null',
      'upsert_delete_affected_rows',
      'strict_head_fencing',
      'complete_discard_cascade',
      'foreign_key_violation_rejected',
      'autoincrement_nonreuse',
      'clear_atomic',
    ]) {
      assert(
        cacheSql[field] === true,
        `full cache SQL contract failed: ${field}`
      );
    }
    const expectedForeignKeyViolation = {
      column_count: 4,
      rows: [
        {
          table: 'optimistic_layers',
          rowid: 9_999_999,
          parent: 'mutation_queue',
          fkid: 0,
        },
      ],
    };
    assert(
      JSON.stringify(cacheSql.foreign_key_check_expected_violation) ===
        JSON.stringify(expectedForeignKeyViolation),
      'foreign_key_check expected four-column violation shape changed'
    );
    assert(
      Array.isArray(cacheSql.foreign_key_check_actual_violation?.rows),
      'foreign_key_check actual decoded rows were not reported'
    );
    report.fullCacheSqlContractPass =
      cacheSql.foreign_key_check_violation_shape === true;
    report.fullCacheSqlKnownFailures = report.fullCacheSqlContractPass
      ? []
      : [
          {
            check:
              'PRAGMA foreign_key_check deliberate violation exact four-column shape',
            expected: expectedForeignKeyViolation,
            actual: cacheSql.foreign_key_check_actual_violation,
          },
        ];
    assert(cacheSql.quick_check === 'ok', 'full cache SQL quick_check failed');
    assert(
      cacheSql.foreign_key_check_rows === 0,
      'full cache SQL foreign_key_check failed'
    );
    assert(
      cacheSql.foreign_key_check_deliberate_violation_rows === 0 &&
        cacheSql.foreign_key_check_actual_violation.column_count === 0 &&
        cacheSql.foreign_key_check_actual_violation.rows.length === 0,
      'foreign_key_check deliberate-violation behavior changed; review Gate G0'
    );
    assert(
      JSON.stringify(cacheSql.canonical_scan) ===
        JSON.stringify(['Type0:1', 'Type:9', 'Type:tenant:1']),
      'full cache SQL canonical scan order failed'
    );
    report.sameWorkerCachePersistence = await first.worker.call(
      'verifyFullCachePersistence'
    );
    report.sqlWrite = await first.worker.call('sqlWrite', {
      value: 'persisted-v1',
    });
    report.sameWorkerReopen = await first.worker.call('sqlRead');
    report.serializedQueue = await Promise.all([
      first.worker.call('sqlRead'),
      first.worker.call('sqlRead'),
    ]);
    assert(
      report.sqlWrite.value.journal_mode === 'wal',
      'Turso did not use WAL mode'
    );
    assert(
      report.sameWorkerReopen.value.value === 'persisted-v1',
      'same-worker reopen lost SQL data'
    );
    assert(
      report.serializedQueue.every(
        (entry) => entry.value.value === 'persisted-v1'
      ),
      'serialized worker queue lost data'
    );
    report.firstShutdown = await first.worker.call('shutdown');
    assert(
      report.firstShutdown.evidence.nestedWorkerConstructionCount === 0,
      'nested worker monitor observed construction'
    );
    first.worker.terminate();
    liveWorkers = liveWorkers.filter((worker) => worker !== first.worker);

    const lifecycleOwner = await acquireOwnerUntil({ deadlineMs: 5_000 });
    liveWorkers.push(lifecycleOwner.worker);
    report.lifecycleFailure = await lifecycleOwner.worker.call(
      'lifecycleFailureProbe'
    );
    assert(
      report.lifecycleFailure.closeFailed,
      'injected close unexpectedly succeeded'
    );
    assert(
      report.lifecycleFailure.deleteRejected,
      'delete followed an uncertain close'
    );
    assert(
      report.lifecycleFailure.reopenRejected,
      'poisoned registry reopened'
    );
    assert(
      report.lifecycleFailure.lifecycle.startsWith('poisoned:'),
      'registry was not poisoned'
    );
    lifecycleOwner.worker.terminate();
    liveWorkers = liveWorkers.filter(
      (worker) => worker !== lifecycleOwner.worker
    );

    const removeFailureOwner = await acquireOwnerUntil({ deadlineMs: 5_000 });
    liveWorkers.push(removeFailureOwner.worker);
    report.removeEntryFailure = await removeFailureOwner.worker.call(
      'removeEntryFailureProbe'
    );
    assert(
      report.removeEntryFailure.resetFailed,
      'actual removeEntry failure was not observed'
    );
    assert(
      report.removeEntryFailure.actualRemoveEntryFailure,
      'removeEntry failure did not retain its browser error cause'
    );
    assert(
      report.removeEntryFailure.secondResetRejected,
      'poisoned remove reset retried'
    );
    assert(
      report.removeEntryFailure.reopenRejected,
      'remove failure poison reopened'
    );
    assert(
      report.removeEntryFailure.lifecycle.startsWith('poisoned:'),
      'remove failure did not poison'
    );
    assert(
      report.removeEntryFailure.artifactCleaned,
      'remove failure artifact was not cleaned'
    );
    removeFailureOwner.worker.terminate();
    liveWorkers = liveWorkers.filter(
      (worker) => worker !== removeFailureOwner.worker
    );

    const recreationFailureOwner = await acquireOwnerUntil({
      deadlineMs: 5_000,
    });
    liveWorkers.push(recreationFailureOwner.worker);
    report.recreationFailure = await recreationFailureOwner.worker.call(
      'recreationFailureProbe'
    );
    assert(
      report.recreationFailure.resetFailed,
      'actual recreation failure was not observed'
    );
    assert(
      report.recreationFailure.actualRecreationFailure,
      'recreation failure did not retain its browser error cause'
    );
    assert(
      report.recreationFailure.secondResetRejected,
      'poisoned recreation reset retried'
    );
    assert(
      report.recreationFailure.reopenRejected,
      'recreation failure poison reopened'
    );
    assert(
      report.recreationFailure.lifecycle.startsWith('poisoned:'),
      'recreation failure did not poison'
    );
    assert(
      report.recreationFailure.artifactCleaned,
      'recreation failure artifact was not cleaned'
    );
    recreationFailureOwner.worker.terminate();
    liveWorkers = liveWorkers.filter(
      (worker) => worker !== recreationFailureOwner.worker
    );

    const second = await acquireOwnerUntil({ deadlineMs: 5_000 });
    liveWorkers.push(second.worker);
    report.crossWorkerCachePersistence = await second.worker.call(
      'verifyFullCachePersistence'
    );
    assert(
      report.crossWorkerCachePersistence.value.record_rows === 3,
      'cross-worker reopen lost full cache SQL records'
    );
    report.crossWorkerReopen = await second.worker.call('sqlRead');
    assert(
      report.crossWorkerReopen.value.value === 'persisted-v1',
      'cross-worker reopen lost SQL data'
    );

    const excluded = new ProbeWorker();
    liveWorkers.push(excluded);
    const excludedInit = await excluded.call('initOwner', {
      lockName: LOCK_NAME,
    });
    report.webLockExclusion = {
      ownerAcquired: true,
      contenderAcquired: excludedInit.acquired,
    };
    assert(
      !excludedInit.acquired,
      'two workers acquired the database Web Lock'
    );
    excluded.terminate();
    liveWorkers = liveWorkers.filter((worker) => worker !== excluded);

    const killRpc = second.worker.call('killWrite', {}, 120_000);
    const firstCommit = await second.worker.waitForEvent(
      'kill-first-commit',
      () => true,
      30_000
    );
    assert(
      firstCommit.commitCount === 1,
      'kill event was not the first successful commit'
    );
    assert(
      firstCommit.runtimeEvidence?.productionReachableWasmTrapCount === 0 &&
        firstCommit.runtimeEvidence?.expectedNegativeWasmTrapCount === 0 &&
        firstCommit.runtimeEvidence?.unhandledRuntimeFailureCount === 0,
      'actively killed worker reported a trap/unhandled failure before first commit'
    );
    assert(
      firstCommit.postSizes['graphql-cache.db'] >=
        firstCommit.preSizes['graphql-cache.db'],
      'main file did not reach first-commit size'
    );
    assert(
      firstCommit.postSizes['graphql-cache.db-wal'] > 0,
      'WAL was empty after first successful commit'
    );
    const terminatedAt = new Date().toISOString();
    const terminatedMonotonicMs = performance.now();
    second.worker.terminate();
    liveWorkers = liveWorkers.filter((worker) => worker !== second.worker);
    let pendingRpcRejected = false;
    let pendingRpcError;
    try {
      await killRpc;
    } catch (error) {
      pendingRpcRejected = true;
      pendingRpcError = {
        name: error.name,
        message: error.message,
        wasmEnvironmentTrap: error.wasmEnvironmentTrap === true,
        routeClassification: error.routeClassification ?? 'harness-control',
      };
    }
    assert(
      pendingRpcRejected,
      'kill RPC did not reject after worker termination'
    );
    report.workerKill = {
      terminatedWhileCallActive: true,
      pendingRpcRejected,
      pendingRpcError,
      firstCommit,
      terminatedAt,
      terminatedMonotonicMs,
    };

    const recovery = await recoverDatabaseUntil();
    report.recovery = recovery.recovery;
    report.abruptReset = {
      registration: recovery.result.registration,
      preopenSizes: recovery.result.preopenSizes,
      committed: recovery.result.committed,
      close: recovery.result.close,
      reset: recovery.result.reset,
    };
    assert(
      report.abruptReset.committed.finite_bound === firstCommit.finiteBound,
      'kill and recovery finite bounds differ'
    );
    assert(
      report.abruptReset.committed.committed_rows >= 1,
      'first commit was not durable'
    );
    assert(
      report.abruptReset.committed.committed_rows <
        report.abruptReset.committed.finite_bound,
      'finite kill loop completed before termination; pending-response proof is ambiguous'
    );
    const abruptBefore = report.abruptReset.preopenSizes;
    const abruptReset = report.abruptReset.reset;
    assert(
      abruptBefore['graphql-cache.db'] > 0,
      'recovery pre-open saw no database file'
    );
    assert(
      abruptBefore['graphql-cache.db-wal'] > 0,
      'recovery pre-open saw no WAL file'
    );
    assert(
      abruptReset.deleted['graphql-cache.db'],
      'abrupt reset did not delete main'
    );
    assert(
      abruptReset.deleted['graphql-cache.db-wal'],
      'abrupt reset did not delete WAL'
    );
    assert(
      abruptReset.recreated['graphql-cache.db'] === 0 &&
        abruptReset.recreated['graphql-cache.db-wal'] === 0,
      'recreated files were not empty'
    );
    const freshOwner = await acquireOwnerUntil({ deadlineMs: 5_000 });
    liveWorkers.push(freshOwner.worker);
    report.freshRecovery = await freshOwner.worker.call('freshRecovery');
    assert(
      report.freshRecovery.value.count_before === 0,
      'fresh recovery retained old SQL rows'
    );
    report.freshShutdown = await freshOwner.worker.call('shutdown');
    assert(
      report.freshShutdown.evidence.productionReachableWasmTrapCount === 0 &&
        report.freshShutdown.evidence.unhandledRuntimeFailureCount === 0,
      'fresh recovery worker observed a runtime trap/failure'
    );
    freshOwner.worker.terminate();
    liveWorkers = liveWorkers.filter((worker) => worker !== freshOwner.worker);

    assert(
      report.firstShutdown.evidence.productionReachableWasmTrapCount === 0 &&
        report.firstShutdown.evidence.unhandledRuntimeFailureCount === 0,
      'clean persistence worker observed a runtime trap/failure'
    );

    // This negative-only worker is intentionally outside the enumerated
    // production routes and is terminated immediately after the retained temp
    // MemoryIO/Instant trap is captured.
    const negativeOwner = await acquireOwnerUntil({
      deadlineMs: 5_000,
      routeClassification: 'explicit-temp-negative',
    });
    liveWorkers.push(negativeOwner.worker);
    report.explicitTempNegativeReset = await negativeOwner.worker.call(
      'resetTransactionProbe'
    );
    report.explicitTempNegative = await negativeOwner.worker.call(
      'explicitTempNegativeProbe',
      {},
      30_000
    );
    assert(
      report.explicitTempNegative.retainedTempBackend ===
        'turso_core::MemoryIO',
      'explicit temp negative route lost its retained MemoryIO classification'
    );
    assert(
      report.explicitTempNegative.expectedTrap.wasmEnvironmentTrap === true &&
        report.explicitTempNegative.expectedTrap.routeClassification ===
          'explicit-temp-negative',
      'explicit temp negative probe did not retain its expected trap classification'
    );
    assert(
      /std::time::Instant::now|not implemented on this platform/.test(
        report.explicitTempNegative.expectedTrap.stack ?? ''
      ) &&
        /ensure_temp_database|create_temp_database|open_file_with_flags/.test(
          report.explicitTempNegative.expectedTrap.stack ?? ''
        ),
      'explicit temp negative trap lost its Instant/temp MemoryIO cause'
    );
    assert(
      report.explicitTempNegative.runtimeEvidence
        .productionReachableWasmTrapCount === 0 &&
        report.explicitTempNegative.runtimeEvidence
          .expectedNegativeWasmTrapCount === 1 &&
        report.explicitTempNegative.runtimeEvidence
          .unhandledRuntimeFailureCount === 0 &&
        report.explicitTempNegative.runtimeEvidence
          .workerRouteClassification === 'explicit-temp-negative',
      'explicit temp negative worker counters were not isolated'
    );
    negativeOwner.worker.terminate();
    liveWorkers = liveWorkers.filter(
      (worker) => worker !== negativeOwner.worker
    );

    report.workerConstructionCount = workerConstructionCount;
    report.noNestedWorker = {
      runtimeMonitorInstalled: true,
      constructionCount:
        report.firstShutdown.evidence.nestedWorkerConstructionCount,
      sourceInspectionRequired: true,
    };
    report.operationalPass = true;
    report.pass = report.fullCacheSqlContractPass;
    if (!report.pass) {
      report.error = {
        name: 'ConformanceFailure',
        message:
          'selected WP-04 SQL routes failed PRAGMA foreign_key_check exact violation detection',
        stack: null,
        wasmEnvironmentTrap: false,
        routeClassification: 'conformance',
      };
    }
    assertHeadRuntimeSafety(report);
    return report;
  } catch (error) {
    report.pass = false;
    report.error = {
      name: error.name,
      message: error.message,
      stack: error.stack ?? null,
      wasmEnvironmentTrap: isWasmEnvironmentTrap(error),
      routeClassification: 'page-harness',
    };
    report.workerConstructionCount = workerConstructionCount;
    report.runtimeSafety ??= runtimeSafetySnapshot();
    return report;
  } finally {
    for (const worker of liveWorkers) worker.terminate();
  }
}

async function renderRun() {
  runButton.disabled = true;
  resultNode.dataset.state = 'running';
  resultNode.textContent = 'running';
  const report = await runProbe();
  resultNode.textContent = JSON.stringify(report, null, 2);
  resultNode.dataset.state = 'done';
  globalThis.__tursoOpfsReport = report;
}

runButton.addEventListener('click', () => void renderRun());
if (new URL(location.href).searchParams.get('autorun') === '1') {
  setTimeout(() => void renderRun(), 0);
}
