import { databaseOwnerLockName } from '../coordinator-protocol';
import type {
  ProductionHarnessCommand,
  ProductionHarnessEnvelope,
} from './production-browser-wire';

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
  requestId?: number;
  requestKind?: string;
  slow?: boolean;
  reason?: string;
};

const assert: (condition: unknown, message: string) => asserts condition = (
  condition,
  message
) => {
  if (!condition) throw new Error(message);
};

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
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
  }
};

const run = async (): Promise<Record<string, unknown>> => {
  const scope = `wp08-production-${crypto.randomUUID()}`;
  const tabIds = ['production-a', 'production-b', 'production-c'] as const;
  const tabChannel = new BroadcastChannel(
    `graphql-cache-wp08-production-tabs:${scope}`
  );
  const telemetryChannel = new BroadcastChannel(
    `graphql-cache-wp08-production:${scope}`
  );
  const popups = new Map<string, Window>();
  const registered = new Set<string>();
  const workers: Array<{ tabId: string; ownerEpoch: number }> = [];
  const terminated: Array<{
    tabId: string;
    ownerEpoch: number;
    reason: string;
  }> = [];
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
          tabId: message.tabId,
          ownerEpoch: message.event.ownerEpoch,
          reason: message.event.reason,
        });
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
  telemetryChannel.onmessage = (event: MessageEvent<RuntimeTelemetry>) => {
    telemetry.push(event.data);
  };

  const command = async (
    targetTabId: string,
    value: CommandWithoutId
  ): Promise<unknown> => {
    const commandId = crypto.randomUUID();
    const result = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingCommands.delete(commandId);
        reject(new Error(`production command timed out: ${value.kind}`));
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

  const latestOwner = (minimumEpoch = 0) =>
    workers.toReversed().find((worker) => worker.ownerEpoch >= minimumEpoch);

  const ownerLockName = databaseOwnerLockName(scope);
  const queueOwnerLockContender = () => {
    let release!: () => void;
    let markAcquired!: () => void;
    const acquired = new Promise<void>((resolve) => {
      markAcquired = resolve;
    });
    const heldUntilReleased = new Promise<void>((resolve) => {
      release = resolve;
    });
    const completed = navigator.locks.request(
      ownerLockName,
      { mode: 'exclusive' },
      async (lock) => {
        assert(lock, 'production lock contender did not acquire the lock');
        markAcquired();
        await heldUntilReleased;
      }
    );
    return { acquired, release, completed };
  };
  const waitForPendingReplacementLock = async (
    description: string
  ): Promise<{ held: number; pending: number }> => {
    let evidence = { held: 0, pending: 0 };
    await waitUntil(description, async () => {
      const snapshot = await navigator.locks.query();
      evidence = {
        held:
          snapshot.held?.filter((lock) => lock.name === ownerLockName).length ??
          0,
        pending:
          snapshot.pending?.filter((lock) => lock.name === ownerLockName)
            .length ?? 0,
      };
      return evidence.held === 1 && evidence.pending === 1;
    });
    return evidence;
  };

  for (const tabId of tabIds) {
    const url = new URL('./production-tab.html', location.href);
    url.searchParams.set('scope', scope);
    url.searchParams.set('tabId', tabId);
    const popup = window.open(url, `${scope}:${tabId}`);
    if (!popup) throw new Error(`popup blocked for ${tabId}`);
    popups.set(tabId, popup);
  }

  await waitUntil(
    'three production registrations',
    () => registered.size === 3
  );
  await waitUntil('production epoch 1 ready', () =>
    telemetry.some((event) => event.kind === 'ready' && event.ownerEpoch === 1)
  );
  const first = latestOwner(1);
  assert(first, 'missing production epoch 1 owner');
  const firstStandby = tabIds.find((tabId) => tabId !== first.tabId);
  assert(firstStandby, 'missing production standby');

  await command(firstStandby, { kind: 'write', value: 'real-preserved' });
  expectProductionHit(
    await command(firstStandby, { kind: 'read' }),
    'real-preserved'
  );

  const gracefulLock = queueOwnerLockContender();
  const graceful = command(first.tabId, { kind: 'graceful-close' });
  await gracefulLock.acquired;
  await graceful;
  await waitUntil('production epoch 1 drained', () =>
    telemetry.some(
      (event) => event.kind === 'drained' && event.ownerEpoch === 1
    )
  );
  await waitUntil('production epoch 2 activation', () =>
    telemetry.some(
      (event) => event.kind === 'activation-started' && event.ownerEpoch === 2
    )
  );
  const gracefulLockEvidence = await waitForPendingReplacementLock(
    'epoch 2 exact owner lock request to become pending'
  );
  const gracefulWaitedForPhysicalLock = !telemetry.some(
    (event) => event.kind === 'ready' && event.ownerEpoch === 2
  );
  assert(
    gracefulWaitedForPhysicalLock,
    'graceful replacement bypassed the held physical owner lock'
  );
  gracefulLock.release();
  await gracefulLock.completed;
  await waitUntil('production epoch 2 ready', () =>
    telemetry.some((event) => event.kind === 'ready' && event.ownerEpoch === 2)
  );
  const second = latestOwner(2);
  assert(second, 'missing production epoch 2 owner');
  expectProductionHit(
    await command(second.tabId, { kind: 'read' }),
    'real-preserved'
  );

  await command(second.tabId, { kind: 'write', value: 'real-must-wipe' });
  expectProductionHit(
    await command(second.tabId, { kind: 'read' }),
    'real-must-wipe'
  );
  const requester = tabIds.find(
    (tabId) => tabId !== first.tabId && tabId !== second.tabId
  );
  assert(requester, 'missing production abrupt requester');
  const slow = command(requester, { kind: 'slow-read' }).then(
    () => '',
    (error: unknown) => (error instanceof Error ? error.message : String(error))
  );
  await waitUntil('production slow request admission', () =>
    telemetry.some(
      (event) =>
        event.kind === 'request-admitted' &&
        event.ownerEpoch === 2 &&
        event.slow === true
    )
  );

  const abruptLock = queueOwnerLockContender();
  const secondPage = popups.get(second.tabId);
  assert(
    secondPage && !secondPage.closed,
    'production owner page closed early'
  );
  await command(second.tabId, { kind: 'crash-worker' });
  const abruptError = await slow;
  assert(
    abruptError.includes('owner epoch 2 was lost'),
    'production in-flight request was not rejected on abrupt loss'
  );
  await abruptLock.acquired;
  await waitUntil('production epoch 3 recovery activation', () =>
    telemetry.some(
      (event) => event.kind === 'activation-started' && event.ownerEpoch === 3
    )
  );
  const recoveryLockEvidence = await waitForPendingReplacementLock(
    'epoch 3 exact owner lock request to become pending'
  );
  const recoveryWaitedForPhysicalLock = !telemetry.some(
    (event) => event.kind === 'ready' && event.ownerEpoch === 3
  );
  assert(
    recoveryWaitedForPhysicalLock,
    'recovery replacement bypassed the held physical owner lock'
  );
  abruptLock.release();
  await abruptLock.completed;
  await waitUntil('production epoch 3 recovery ready', () =>
    telemetry.some((event) => event.kind === 'ready' && event.ownerEpoch === 3)
  );
  const third = latestOwner(3);
  assert(third, 'missing production epoch 3 owner');
  expectProductionMiss(await command(third.tabId, { kind: 'read' }));

  const slowAdmissions = telemetry.filter(
    (event) => event.kind === 'request-admitted' && event.slow === true
  );
  assert(slowAdmissions.length === 1, 'abrupt in-flight request was replayed');
  assert(!secondPage.closed, 'production worker crash closed its owner page');
  assert(
    terminated.some(
      (event) =>
        event.ownerEpoch === 2 &&
        event.reason.includes('production harness induced worker crash')
    ),
    'production worker crash reason was not attributed'
  );
  assert(protocolErrors.length === 0, 'production coordinator protocol error');

  const result = {
    passed: true,
    realTursoDataPreservedGracefully: true,
    gracefulCloseReleasedOwnerLock: telemetry.some(
      (event) => event.kind === 'drained' && event.ownerEpoch === 1
    ),
    gracefulReplacementWaitedForPhysicalLock: gracefulWaitedForPhysicalLock,
    gracefulPendingOwnerLockRequests: gracefulLockEvidence.pending,
    abruptInflightRejected: abruptError.includes('owner epoch 2 was lost'),
    abruptRequestReplayCount: slowAdmissions.length,
    abruptOwnerPageStayedAlive: !secondPage.closed,
    recoveryReplacementWaitedForPhysicalLock: recoveryWaitedForPhysicalLock,
    recoveryPendingOwnerLockRequests: recoveryLockEvidence.pending,
    atomicRecoveryOpenWipedToMiss: true,
    recoveryDatabaseAction: telemetry.find(
      (event) => event.kind === 'ready' && event.ownerEpoch === 3
    )?.databaseAction,
    ownerEpochs: workers.map((worker) => worker.ownerEpoch),
    protocolErrors,
  };

  for (const popup of popups.values()) popup.close();
  tabChannel.close();
  telemetryChannel.close();
  return result;
};

function expectProductionHit(value: unknown, expected: string): void {
  assert(
    typeof value === 'object' &&
      value !== null &&
      (value as { kind?: unknown }).kind === 'hit' &&
      (
        value as {
          data?: { user?: { soup?: { items?: Array<{ id?: unknown }> } } };
        }
      ).data?.user?.soup?.items?.[0]?.id === expected,
    `expected production cache hit ${expected}`
  );
}

function expectProductionMiss(value: unknown): void {
  assert(
    typeof value === 'object' &&
      value !== null &&
      (value as { kind?: unknown }).kind === 'miss',
    'expected production cache miss'
  );
}

void run().then(
  (result) => {
    resultElement.dataset.status = 'passed';
    resultElement.textContent = JSON.stringify(result, null, 2);
  },
  (error: unknown) => {
    resultElement.dataset.status = 'failed';
    resultElement.textContent =
      error instanceof Error ? (error.stack ?? error.message) : String(error);
  }
);
