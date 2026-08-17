const resultNode = document.querySelector('#result');
const runButton = document.querySelector('#run');
const LOCK_NAME = 'graphql-cache-turso-opfs-spike-owner';
const LOCK_RECOVERY_DEADLINE_MS = 30_000;
let workerConstructionCount = 0;
let sequence = 0;

class ProbeWorker {
  constructor() {
    workerConstructionCount += 1;
    this.worker = new Worker('./worker.js', { type: 'module' });
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
        if (message.ok) pending.resolve(message.result);
        else
          pending.reject(
            Object.assign(new Error(message.error.message), message.error)
          );
        return;
      }
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
      this.rejectAll(new Error(event.message || 'worker error'));
    });
  }

  call(command, payload = {}, timeoutMs = 60_000) {
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${command} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timeout });
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
        reject(new Error(`event ${event} timed out after ${timeoutMs}ms`));
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
    this.rejectAll(new Error('worker terminated while RPC pending'));
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const delay = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

async function acquireOwnerUntil({
  deadlineMs = 1_000,
  retryDelayMs = 100,
} = {}) {
  const startedAt = new Date().toISOString();
  const startedMonotonicMs = performance.now();
  const deadline = startedMonotonicMs + deadlineMs;
  let attempts = 0;
  let last;
  while (performance.now() <= deadline) {
    attempts += 1;
    const candidate = new ProbeWorker();
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

async function expectedTrap(worker, command) {
  try {
    await worker.call(command, {}, 30_000);
    return { trapped: false, error: null };
  } catch (error) {
    return {
      trapped: true,
      error: {
        name: error.name,
        message: error.message,
        stack: error.stack ?? null,
      },
    };
  }
}

async function runProbe() {
  const workersBeforeFirstUse = workerConstructionCount;
  const report = {
    startedAt: new Date().toISOString(),
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

    const first = await acquireOwnerUntil();
    liveWorkers.push(first.worker);
    report.capabilities = first.init.capabilities;
    assert(
      first.init.capabilities.dedicatedWorker,
      'engine did not run in a DedicatedWorker'
    );
    assert(
      first.init.capabilities.storageGetDirectory,
      'OPFS getDirectory is unavailable'
    );
    assert(
      first.init.capabilities.webLocks,
      'Web Locks is unavailable in DedicatedWorker'
    );
    assert(
      !first.init.capabilities.crossOriginIsolated,
      'test unexpectedly used cross-origin isolation'
    );
    assert(
      first.init.capabilities.nestedWorkerMonitorInstalled,
      'nested-worker monitor missing'
    );
    assert(
      first.init.capabilities.nestedWorkerConstructionCount === 0,
      'nested worker constructed'
    );

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
      pendingRpcError = { name: error.name, message: error.message };
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
    await freshOwner.worker.call('shutdown');
    freshOwner.worker.terminate();
    liveWorkers = liveWorkers.filter((worker) => worker !== freshOwner.worker);

    const memoryOwner = await acquireOwnerUntil({ deadlineMs: 5_000 });
    liveWorkers.push(memoryOwner.worker);
    report.memoryIoProbe = await expectedTrap(
      memoryOwner.worker,
      'memoryProbe'
    );
    assert(
      report.memoryIoProbe.trapped,
      'built-in MemoryIO unexpectedly worked on wasm32'
    );
    assert(
      report.memoryIoProbe.error.stack?.includes('std::time::Instant::now'),
      'MemoryIO trap did not retain Instant cause'
    );
    memoryOwner.worker.terminate();
    liveWorkers = liveWorkers.filter((worker) => worker !== memoryOwner.worker);

    const immediateOwner = await acquireOwnerUntil({ deadlineMs: 5_000 });
    liveWorkers.push(immediateOwner.worker);
    report.beginImmediateProbe = await expectedTrap(
      immediateOwner.worker,
      'beginImmediateProbe'
    );
    assert(
      report.beginImmediateProbe.trapped,
      'BEGIN IMMEDIATE unexpectedly worked on wasm32'
    );
    const immediateStack = report.beginImmediateProbe.error.stack ?? '';
    assert(
      immediateStack.includes('std::time::Instant::now'),
      'immediate trap lost Instant cause'
    );
    assert(
      /ensure_temp_database|create_temp_database|open_file_with_flags/.test(
        immediateStack
      ),
      'immediate trap lost temp-database cause'
    );
    immediateOwner.worker.terminate();
    liveWorkers = liveWorkers.filter(
      (worker) => worker !== immediateOwner.worker
    );

    report.workerConstructionCount = workerConstructionCount;
    report.noNestedWorker = {
      runtimeMonitorInstalled: true,
      constructionCount:
        report.firstShutdown.evidence.nestedWorkerConstructionCount,
      sourceInspectionRequired: true,
    };
    report.pass = true;
    return report;
  } catch (error) {
    report.pass = false;
    report.error = {
      name: error.name,
      message: error.message,
      stack: error.stack ?? null,
    };
    report.workerConstructionCount = workerConstructionCount;
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
