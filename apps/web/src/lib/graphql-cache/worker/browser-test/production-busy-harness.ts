import {
  cacheDatabaseIdentity,
  databaseOwnerLockName,
} from '../coordinator-protocol';
import type {
  ProductionHarnessCommand,
  ProductionHarnessEnvelope,
} from './production-browser-wire';
import type {
  FileHolderRequest,
  FileHolderResponse,
} from './production-cache.file-holder-worker';

// A page that leaves while it owns the cache terminates its engine worker. The
// browser can hand the owner Web Lock to the next engine before that worker
// lets go of the database files. This harness recreates that gap with a worker
// that keeps the files open without the lock.

const resultElement = document.querySelector<HTMLElement>('#result');
if (!resultElement) throw new Error('missing result element');

type CommandWithoutId = ProductionHarnessCommand extends infer Command
  ? Command extends ProductionHarnessCommand
    ? Omit<Command, 'commandId'>
    : never
  : never;

type RuntimeTelemetry = {
  kind: string;
  tabId: string;
  ownerEpoch: number;
  databaseAction: 'open-existing' | 'wipe-before-open';
  receivedAt: number;
};

/** Longer than both the retry this change replaced and the gap seen in
 * production, and well inside the engine's busy-file wait. */
const HOLD_AFTER_OWNER_LOCK_MS = 3_000;

const assert: (condition: unknown, message: string) => asserts condition = (
  condition,
  message
) => {
  if (!condition) throw new Error(message);
};

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

const waitUntil = async (
  description: string,
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 30_000
): Promise<void> => {
  const started = performance.now();
  while (!(await predicate())) {
    if (performance.now() - started > timeoutMs) {
      throw new Error(`timed out waiting for ${description}`);
    }
    await sleep(20);
  }
};

const run = async (): Promise<Record<string, unknown>> => {
  const scope = `busy-files-${crypto.randomUUID()}`;
  const identity = cacheDatabaseIdentity(scope);
  const ownerLockName = databaseOwnerLockName(scope);
  const tabChannel = new BroadcastChannel(
    `graphql-cache-wp08-production-tabs:${scope}`
  );
  const telemetryChannel = new BroadcastChannel(
    `graphql-cache-wp08-production:${scope}`
  );
  const popups = new Map<string, Window>();
  const registered = new Set<string>();
  const workers: Array<{ tabId: string; ownerEpoch: number }> = [];
  const terminated: Array<{ ownerEpoch: number; reason: string }> = [];
  const unavailable = new Map<string, string>();
  const telemetry: RuntimeTelemetry[] = [];
  const protocolErrors: string[] = [];
  const pendingCommands = new Map<
    string,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();

  tabChannel.onmessage = (event: MessageEvent<ProductionHarnessEnvelope>) => {
    const message = event.data;
    if (message.source !== 'tab') return;
    switch (message.event.kind) {
      case 'registered':
        registered.add(message.tabId);
        break;
      case 'worker-created':
        workers.push({
          tabId: message.tabId,
          ownerEpoch: message.event.ownerEpoch,
        });
        break;
      case 'worker-terminated':
        terminated.push({
          ownerEpoch: message.event.ownerEpoch,
          reason: message.event.reason,
        });
        break;
      case 'cache-unavailable':
        unavailable.set(message.tabId, message.event.reason);
        break;
      case 'protocol-error':
        protocolErrors.push(message.event.error);
        break;
      case 'command-result': {
        const pending = pendingCommands.get(message.event.commandId);
        if (!pending) return;
        pendingCommands.delete(message.event.commandId);
        clearTimeout(pending.timer);
        if (message.event.ok) pending.resolve(message.event.result);
        else pending.reject(new Error(message.event.error));
        break;
      }
    }
  };
  telemetryChannel.onmessage = (
    event: MessageEvent<Omit<RuntimeTelemetry, 'receivedAt'>>
  ) => {
    telemetry.push({ ...event.data, receivedAt: performance.now() });
  };

  const command = async (
    targetTabId: string,
    value: CommandWithoutId
  ): Promise<unknown> => {
    const commandId = crypto.randomUUID();
    const result = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingCommands.delete(commandId);
        reject(new Error(`busy-file command timed out: ${value.kind}`));
      }, 30_000);
      pendingCommands.set(commandId, { resolve, reject, timer });
    });
    tabChannel.postMessage({
      source: 'harness',
      targetTabId,
      command: { ...value, commandId } as ProductionHarnessCommand,
    } satisfies ProductionHarnessEnvelope);
    return await result;
  };

  const openTab = (tabId: string): void => {
    const url = new URL('./production-tab.html', location.href);
    url.searchParams.set('scope', scope);
    url.searchParams.set('tabId', tabId);
    const popup = window.open(url, `${scope}:${tabId}`);
    if (!popup) throw new Error(`popup blocked for ${tabId}`);
    popups.set(tabId, popup);
  };

  const ownerOf = (ownerEpoch: number) => {
    const owner = workers.find((worker) => worker.ownerEpoch === ownerEpoch);
    assert(owner, `missing owner for epoch ${ownerEpoch}`);
    return owner;
  };

  const event = (kind: string, ownerEpoch: number) =>
    telemetry.find(
      (candidate) =>
        candidate.kind === kind && candidate.ownerEpoch === ownerEpoch
    );

  const heldOwnerLocks = async (): Promise<number> =>
    (await navigator.locks.query()).held?.filter(
      (lock) => lock.name === ownerLockName
    ).length ?? 0;

  const holder = new Worker(
    new URL('./production-cache.file-holder-worker.ts', import.meta.url),
    { type: 'module', name: `busy-file-holder:${scope}` }
  );
  const askHolder = (request: FileHolderRequest): Promise<void> =>
    new Promise((resolve, reject) => {
      holder.onmessage = (message: MessageEvent<FileHolderResponse>) => {
        if (message.data.kind === 'error')
          reject(new Error(message.data.error));
        else resolve();
      };
      holder.postMessage(request);
    });

  /**
   * The owner leaves like a navigating page. While the harness holds the
   * owner lock the holder opens both files, then the next engine may take the
   * lock and finds the files busy. Resolves when that engine holds the lock.
   */
  const leaveWhileFilesStayOpen = async (
    ownerEpoch: number
  ): Promise<number> => {
    let releaseLock!: () => void;
    let markAcquired!: () => void;
    const acquired = new Promise<void>((resolve) => {
      markAcquired = resolve;
    });
    const lockReleased = navigator.locks.request(
      ownerLockName,
      { mode: 'exclusive' },
      async () => {
        markAcquired();
        await new Promise<void>((resolve) => {
          releaseLock = resolve;
        });
      }
    );
    await command(ownerOf(ownerEpoch).tabId, { kind: 'navigate-away' });
    await acquired;
    await askHolder({ kind: 'hold', paths: [identity, `${identity}-wal`] });
    releaseLock();
    await lockReleased;
    await waitUntil(
      `epoch ${ownerEpoch + 1} to take the owner lock`,
      async () => (await heldOwnerLocks()) === 1
    );
    return performance.now();
  };

  for (const tabId of ['busy-a', 'busy-b', 'busy-c']) openTab(tabId);
  await waitUntil('three registrations', () => registered.size === 3);
  await waitUntil('epoch 1 ready', () => event('ready', 1) !== undefined);
  const standby = [...registered].find((tabId) => tabId !== ownerOf(1).tabId);
  assert(standby, 'missing standby');
  await command(standby, { kind: 'write', value: 'busy-preserved' });

  // Phase 1: the files stay open for 3 seconds after the next engine takes
  // the owner lock. It must wait and reopen the same database.
  const firstLockedAt = await leaveWhileFilesStayOpen(1);
  assert(
    event('activation-started', 2)?.databaseAction === 'open-existing',
    'navigation replacement did not start with open-existing'
  );
  await sleep(HOLD_AFTER_OWNER_LOCK_MS);
  assert(!event('ready', 2), 'epoch 2 opened while its files were busy');
  await askHolder({ kind: 'release' });
  const firstReleasedAt = performance.now();
  await waitUntil('epoch 2 ready', () => event('ready', 2) !== undefined);
  const secondOwner = ownerOf(2).tabId;
  expectHit(await command(secondOwner, { kind: 'read' }), 'busy-preserved');
  const firstRecoveryAttempts = telemetry.filter(
    (candidate) =>
      candidate.kind === 'activation-started' && candidate.ownerEpoch > 2
  ).length;

  // Phase 2: the files stay open past the engine's whole wait. The cache
  // must turn off quietly without wiping, and a later tab reopens the data.
  const survivor = [...registered].find(
    (tabId) => tabId !== ownerOf(1).tabId && tabId !== secondOwner
  );
  assert(survivor, 'missing surviving tab');
  await leaveWhileFilesStayOpen(2);
  await waitUntil(
    'the surviving tab to be told the cache is unavailable',
    () => unavailable.has(survivor),
    30_000
  );
  let survivorRead = 'hit';
  try {
    await command(survivor, { kind: 'read' });
  } catch (error) {
    survivorRead = error instanceof Error ? error.message : String(error);
  }
  await sleep(1_000);
  const retriedWhileBusy = telemetry.some(
    (candidate) =>
      candidate.kind === 'activation-started' && candidate.ownerEpoch > 3
  );
  await askHolder({ kind: 'release' });
  openTab('busy-d');
  await waitUntil('epoch 4 ready', () => event('ready', 4) !== undefined);
  expectHit(
    await command(ownerOf(4).tabId, { kind: 'read' }),
    'busy-preserved'
  );

  const result = {
    passed: true,
    firstReplacementDatabaseAction: event('activation-started', 2)
      ?.databaseAction,
    firstReplacementWaitedForFiles:
      (event('ready', 2)?.receivedAt ?? 0) >= firstReleasedAt &&
      firstReleasedAt - firstLockedAt >= HOLD_AFTER_OWNER_LOCK_MS,
    firstReplacementKeptData: true,
    firstRecoveryAttempts,
    busyReplacementDatabaseAction: event('activation-started', 3)
      ?.databaseAction,
    busyReplacementOpened: event('ready', 3) !== undefined,
    busyReplacementTerminated: terminated.some(
      (candidate) =>
        candidate.ownerEpoch === 3 &&
        candidate.reason.includes('files stayed busy')
    ),
    survivorToldFilesAreOpen:
      unavailable.get(survivor)?.includes('files are still open') ?? false,
    survivorReadFellBack: survivorRead.includes('files are still open'),
    retriedWhileBusy,
    laterTabDatabaseAction: event('activation-started', 4)?.databaseAction,
    laterTabKeptData: true,
    protocolErrors,
  };

  holder.terminate();
  for (const popup of popups.values()) popup.close();
  tabChannel.close();
  telemetryChannel.close();
  return result;
};

function expectHit(value: unknown, expected: string): void {
  assert(
    typeof value === 'object' &&
      value !== null &&
      (value as { kind?: unknown }).kind === 'hit' &&
      (
        value as {
          data?: { user?: { soup?: { items?: Array<{ id?: unknown }> } } };
        }
      ).data?.user?.soup?.items?.[0]?.id === expected,
    `expected cache hit ${expected}`
  );
}

void (async () => {
  try {
    const result = await run();
    resultElement.dataset.status = 'passed';
    resultElement.textContent = JSON.stringify(result, null, 2);
  } catch (error) {
    resultElement.dataset.status = 'failed';
    resultElement.textContent =
      error instanceof Error ? (error.stack ?? error.message) : String(error);
  }
})();
