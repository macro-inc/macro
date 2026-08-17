import init, * as wasm from '../pkg/turso_opfs_spike.js';

let wasmReady;
let ownsLock = false;
let ownerToken;
let releaseLock;
let lockRequestStarted = false;
let activeKill;
let nestedWorkerConstructionCount = 0;
let nestedWorkerMonitorInstalled = false;
const DIRECT_PROBE_PATH = 'direct-file.bin';

if ('stackTraceLimit' in Error) Error.stackTraceLimit = 100;

if (typeof globalThis.Worker === 'function') {
  const WorkerConstructor = globalThis.Worker;
  globalThis.Worker = new Proxy(WorkerConstructor, {
    construct(target, argumentsList, newTarget) {
      nestedWorkerConstructionCount += 1;
      return Reflect.construct(target, argumentsList, newTarget);
    },
  });
  nestedWorkerMonitorInstalled = true;
} else {
  // This worker cannot construct nested workers, which is stronger evidence.
  nestedWorkerMonitorInstalled = true;
}

globalThis.__tursoOpfsKillProgress = (
  commitCount,
  finiteBound,
  mainSize,
  walSize
) => {
  if (!activeKill)
    throw new Error('kill progress arrived without a pending kill RPC');
  self.postMessage({
    event: 'kill-first-commit',
    requestId: activeKill.requestId,
    commitCount,
    finiteBound,
    preSizes: activeKill.preSizes,
    postSizes: {
      'graphql-cache.db': mainSize,
      'graphql-cache.db-wal': walSize,
    },
    writeStartedAt: activeKill.startedAt,
    firstCommitObservedAt: new Date().toISOString(),
    firstCommitObservedMonotonicMs: performance.now(),
  });
};

function errorRecord(error) {
  return {
    name: error?.name ?? 'Error',
    message: error?.message ?? String(error),
    stack: error?.stack ?? null,
  };
}

function response(id, result) {
  self.postMessage({ id, ok: true, result });
}

function failure(id, error) {
  self.postMessage({ id, ok: false, error: errorRecord(error) });
}

function parseRustJson(value) {
  return JSON.parse(value);
}

async function initializeWasm() {
  wasmReady ??= init();
  await wasmReady;
}

function capabilities() {
  return {
    dedicatedWorker: self instanceof DedicatedWorkerGlobalScope,
    storageGetDirectory: typeof navigator.storage?.getDirectory === 'function',
    webLocks: typeof navigator.locks?.request === 'function',
    crossOriginIsolated: self.crossOriginIsolated,
    sharedArrayBufferVisible: typeof SharedArrayBuffer !== 'undefined',
    nestedWorkerMonitorInstalled,
    nestedWorkerConstructionCount,
    registryLifecycle: wasmReady
      ? wasm.registry_lifecycle()
      : 'wasm-not-initialized',
    userAgent: navigator.userAgent,
  };
}

function requestOwner(lockName) {
  if (lockRequestStarted) throw new Error('owner lock was already requested');
  lockRequestStarted = true;
  if (!navigator.locks?.request) {
    return Promise.resolve({
      acquired: false,
      unavailableReason: 'Web Locks API is unavailable in this worker',
      capabilities: capabilities(),
    });
  }

  return new Promise((resolve, reject) => {
    void navigator.locks
      .request(
        lockName,
        { mode: 'exclusive', ifAvailable: true },
        async (lock) => {
          if (!lock) {
            resolve({ acquired: false, capabilities: capabilities() });
            return;
          }
          ownsLock = true;
          try {
            await initializeWasm();
            ownerToken = wasm.claim_owner();
            resolve({
              acquired: true,
              ownerToken,
              capabilities: capabilities(),
            });
            await new Promise((release) => {
              releaseLock = release;
            });
          } catch (error) {
            reject(error);
          } finally {
            ownsLock = false;
          }
        }
      )
      .catch(reject);
  });
}

async function beginSession(kind) {
  const raw =
    kind === 'database'
      ? await wasm.begin_database_session(ownerToken)
      : kind === 'direct'
        ? await wasm.begin_direct_probe_session(ownerToken)
        : await wasm.begin_immediate_probe_session(ownerToken);
  return parseRustJson(raw);
}

function closeSession(session) {
  return parseRustJson(wasm.close_session(ownerToken, session));
}

function releaseClosed(close) {
  wasm.release_closed_session(ownerToken, close.close_token);
}

async function resetKind(kind) {
  const registration = await beginSession(kind);
  const close = closeSession(registration.session);
  const reset = parseRustJson(
    await wasm.reset_closed_session_paths(ownerToken, close.close_token)
  );
  return { registration, close, reset };
}

async function withSession(kind, operation) {
  const registration = await beginSession(kind);
  let value;
  try {
    value = operation(registration.session);
  } finally {
    const close = closeSession(registration.session);
    releaseClosed(close);
  }
  return { registration, value: parseRustJson(value) };
}

async function cleanupDirectFaultArtifact() {
  const root = await navigator.storage.getDirectory();
  try {
    await root.removeEntry(DIRECT_PROBE_PATH, { recursive: true });
    return true;
  } catch (error) {
    if (error?.name === 'NotFoundError') return false;
    throw error;
  }
}

async function assertPoisonRejectsResetAndReopen(closeToken) {
  let secondResetError;
  try {
    await wasm.reset_closed_session_paths(ownerToken, closeToken);
  } catch (error) {
    secondResetError = errorRecord(error);
  }
  let reopenError;
  try {
    await beginSession('direct');
  } catch (error) {
    reopenError = errorRecord(error);
  }
  return {
    secondResetRejected: Boolean(secondResetError),
    secondResetError,
    reopenRejected: Boolean(reopenError),
    reopenError,
    lifecycle: wasm.registry_lifecycle(),
  };
}

async function removeEntryFailureProbe() {
  await cleanupDirectFaultArtifact();
  const registration = await beginSession('direct');
  const close = closeSession(registration.session);
  const root = await navigator.storage.getDirectory();
  await root.removeEntry(DIRECT_PROBE_PATH);
  const conflict = await root.getDirectoryHandle(DIRECT_PROBE_PATH, {
    create: true,
  });
  await conflict.getFileHandle('non-empty-child', { create: true });

  let resetError;
  try {
    await wasm.reset_closed_session_paths(ownerToken, close.close_token);
  } catch (error) {
    resetError = errorRecord(error);
  }
  const poison = await assertPoisonRejectsResetAndReopen(close.close_token);
  const artifactCleaned = await cleanupDirectFaultArtifact();
  return {
    registration,
    close,
    resetFailed: Boolean(resetError),
    resetError,
    actualRemoveEntryFailure:
      /InvalidModificationError|Invalid modification|can not be modified|directory is not empty|non-empty/i.test(
        resetError?.message ?? ''
      ),
    artifactCleaned,
    ...poison,
  };
}

async function recreationFailureProbe() {
  await cleanupDirectFaultArtifact();
  const registration = await beginSession('direct');
  const close = closeSession(registration.session);
  wasm.inject_next_recreation_conflict(ownerToken, close.close_token);

  let resetError;
  try {
    await wasm.reset_closed_session_paths(ownerToken, close.close_token);
  } catch (error) {
    resetError = errorRecord(error);
  }
  const poison = await assertPoisonRejectsResetAndReopen(close.close_token);
  const artifactCleaned = await cleanupDirectFaultArtifact();
  return {
    registration,
    close,
    resetFailed: Boolean(resetError),
    resetError,
    actualRecreationFailure:
      /TypeMismatchError|Wrong type|not an entry of requested type|path.*directory|file.*directory/i.test(
        resetError?.message ?? ''
      ),
    artifactCleaned,
    ...poison,
  };
}

function expectedSyncHandleContention(error) {
  return /InvalidStateError|NoModificationAllowedError|sync access handle|createSyncAccessHandle|access handle.*(active|open|lock)|file.*locked/i.test(
    `${error?.name ?? ''}: ${error?.message ?? error}`
  );
}

async function releaseRecoveryOwner() {
  let releaseError;
  if (ownerToken !== undefined && wasm.registry_lifecycle() === 'idle') {
    try {
      wasm.release_owner(ownerToken);
    } catch (error) {
      releaseError = error;
    }
  }
  ownerToken = undefined;
  releaseLock?.();
  releaseLock = undefined;
  if (releaseError) throw releaseError;
}

async function recoverAfterKill(lockName, remainingMs) {
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) {
    throw new Error('recoverAfterKill requires a positive remainingMs');
  }
  const attemptStartedAt = new Date().toISOString();
  const init = await requestOwner(lockName);
  if (!init.acquired) {
    return { acquired: false, recovered: false, remainingMs, attemptStartedAt };
  }

  let result;
  let failureError;
  try {
    const registration = await beginSession('database');
    const preopenSizes = parseRustJson(
      wasm.active_session_sizes(ownerToken, registration.session)
    );
    let committed;
    let close;
    try {
      committed = parseRustJson(
        wasm.sql_count_kill_probe(ownerToken, registration.session)
      );
    } catch (error) {
      close = closeSession(registration.session);
      releaseClosed(close);
      throw error;
    }
    close = closeSession(registration.session);
    const reset = parseRustJson(
      await wasm.reset_closed_session_paths(ownerToken, close.close_token)
    );
    result = {
      acquired: true,
      recovered: true,
      retryable: false,
      remainingMs,
      attemptStartedAt,
      completedAt: new Date().toISOString(),
      registration,
      preopenSizes,
      committed,
      close,
      reset,
    };
  } catch (error) {
    if (!expectedSyncHandleContention(error)) throw error;
    result = {
      acquired: true,
      recovered: false,
      retryable: true,
      remainingMs,
      attemptStartedAt,
      error: errorRecord(error),
      lifecycle: wasm.registry_lifecycle(),
    };
  } finally {
    try {
      await releaseRecoveryOwner();
    } catch (error) {
      failureError = error;
    }
  }
  if (failureError && !result?.retryable) throw failureError;
  if (failureError) result.releaseError = errorRecord(failureError);
  return result;
}

async function lifecycleFailureProbe() {
  const registration = await beginSession('direct');
  wasm.inject_next_close_failure(ownerToken, registration.session);
  let closeError;
  try {
    closeSession(registration.session);
  } catch (error) {
    closeError = errorRecord(error);
  }
  let resetError;
  try {
    await wasm.reset_closed_session_paths(ownerToken, 1);
  } catch (error) {
    resetError = errorRecord(error);
  }
  let reopenError;
  try {
    await beginSession('direct');
  } catch (error) {
    reopenError = errorRecord(error);
  }
  return {
    closeFailed: Boolean(closeError),
    closeError,
    deleteRejected: Boolean(resetError),
    resetError,
    reopenRejected: Boolean(reopenError),
    reopenError,
    lifecycle: wasm.registry_lifecycle(),
  };
}

async function dispatch(id, command, payload) {
  if (command === 'initOwner') return requestOwner(payload.lockName);
  if (command === 'recoverAfterKill') {
    return recoverAfterKill(payload.lockName, payload.remainingMs);
  }
  if (!ownsLock || ownerToken === undefined) {
    throw new Error(
      `command ${command} requires the database Web Lock owner token`
    );
  }

  switch (command) {
    case 'resetDatabase':
      return resetKind('database');
    case 'directFile': {
      const initialReset = await resetKind('direct');
      const registration = await beginSession('direct');
      let operations;
      let close;
      try {
        operations = parseRustJson(
          wasm.run_direct_file_probe(ownerToken, registration.session)
        );
      } finally {
        close = closeSession(registration.session);
        releaseClosed(close);
      }
      return { initialReset, registration, operations, close };
    }
    case 'lifecycleFailureProbe':
      return lifecycleFailureProbe();
    case 'removeEntryFailureProbe':
      return removeEntryFailureProbe();
    case 'recreationFailureProbe':
      return recreationFailureProbe();
    case 'sqlWrite':
      return withSession('database', (session) =>
        wasm.sql_write_marker(ownerToken, session, payload.value)
      );
    case 'sqlRead':
      return withSession('database', (session) =>
        wasm.sql_read_marker(ownerToken, session)
      );
    case 'freshRecovery':
      return withSession('database', (session) =>
        wasm.sql_verify_fresh_recovery(ownerToken, session)
      );
    case 'memoryProbe':
      wasm.run_builtin_memory_io_probe();
      return { unexpectedlyReturned: true };
    case 'beginImmediateProbe': {
      const registration = await beginSession('immediate');
      wasm.run_begin_immediate_probe(ownerToken, registration.session);
      const close = closeSession(registration.session);
      releaseClosed(close);
      return { unexpectedlyReturned: true };
    }
    case 'killWrite': {
      const registration = await beginSession('database');
      const preSizes = parseRustJson(
        wasm.active_session_sizes(ownerToken, registration.session)
      );
      activeKill = {
        requestId: id,
        preSizes,
        startedAt: new Date().toISOString(),
      };
      // Deliberately keep this RPC pending. The page terminates this worker
      // after Rust reports the first successfully committed write.
      const result = wasm.run_worker_kill_write_loop(
        ownerToken,
        registration.session
      );
      const close = closeSession(registration.session);
      releaseClosed(close);
      activeKill = undefined;
      return { unexpectedlyCompleted: result, close };
    }
    case 'shutdown': {
      const evidence = capabilities();
      if (wasm.registry_lifecycle() !== 'idle') {
        throw new Error(
          `shutdown requires idle registry, got ${wasm.registry_lifecycle()}`
        );
      }
      wasm.release_owner(ownerToken);
      ownerToken = undefined;
      releaseLock?.();
      return { released: true, evidence };
    }
    default:
      throw new Error(`unknown command: ${command}`);
  }
}

let operationQueue = Promise.resolve();
self.addEventListener('message', (event) => {
  const { id, command, payload = {} } = event.data;
  const run = async () => {
    try {
      response(id, await dispatch(id, command, payload));
    } catch (error) {
      failure(id, error);
    }
  };
  // Both success and failure continue the queue. Only one command can enter
  // Rust or mutate lifecycle state at a time, and a long sync kill write keeps
  // every later command queued.
  operationQueue = operationQueue.then(run, run);
});
