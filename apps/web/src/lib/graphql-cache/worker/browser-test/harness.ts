import { databaseOwnerLockName } from '../coordinator-protocol';
import type {
  BrowserHarnessCommand,
  BrowserHarnessEnvelope,
} from './browser-wire';

const resultElement = document.querySelector<HTMLElement>('#result');
if (!resultElement) throw new Error('missing result element');

type CommandWithoutId = BrowserHarnessCommand extends infer Command
  ? Command extends BrowserHarnessCommand
    ? Omit<Command, 'commandId'>
    : never
  : never;

type EngineTelemetry = {
  kind: string;
  tabId?: string;
  ownerEpoch: number;
  routeId?: number;
  requestKind?: string;
  requestId?: number;
  slow?: boolean;
  snapshot?: { staleMessageDrops?: number };
};

const waitUntil = async (
  description: string,
  predicate: () => boolean,
  timeoutMs = 20_000
): Promise<void> => {
  const started = performance.now();
  while (!predicate()) {
    if (performance.now() - started > timeoutMs) {
      throw new Error(`timed out waiting for ${description}`);
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
  }
};

const assert: (condition: unknown, message: string) => asserts condition = (
  condition,
  message
) => {
  if (!condition) throw new Error(message);
};

const run = async (): Promise<Record<string, unknown>> => {
  const scope = `wp08-${crypto.randomUUID()}`;
  const tabChannel = new BroadcastChannel(`graphql-cache-wp08-tabs:${scope}`);
  const telemetryChannel = new BroadcastChannel(`graphql-cache-wp08:${scope}`);
  const tabIds = ['tab-a', 'tab-b', 'tab-c'] as const;
  const popups = new Map<string, Window>();
  const registered = new Set<string>();
  const adapterCreated = new Set<string>();
  const eventOrder = new Map<string, string[]>();
  const workers: Array<{ tabId: string; ownerEpoch: number }> = [];
  const terminated: Array<{
    tabId: string;
    ownerEpoch: number;
    reason: string;
  }> = [];
  const replacements = new Set<number>();
  const pushes = new Map<string, number>();
  const telemetry: EngineTelemetry[] = [];
  const pendingCommands = new Map<
    string,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  const protocolErrors: string[] = [];

  const remember = (tabId: string, kind: string): void => {
    const events = eventOrder.get(tabId) ?? [];
    events.push(kind);
    eventOrder.set(tabId, events);
  };

  tabChannel.onmessage = (event: MessageEvent<BrowserHarnessEnvelope>) => {
    const envelope = event.data;
    if (envelope.source !== 'tab') return;
    const tabEvent = envelope.event;
    remember(envelope.tabId, tabEvent.kind);
    switch (tabEvent.kind) {
      case 'adapter-created':
        adapterCreated.add(envelope.tabId);
        break;
      case 'registered':
        registered.add(envelope.tabId);
        break;
      case 'worker-created':
        workers.push({
          tabId: envelope.tabId,
          ownerEpoch: tabEvent.ownerEpoch,
        });
        break;
      case 'worker-terminated':
        terminated.push({
          tabId: envelope.tabId,
          ownerEpoch: tabEvent.ownerEpoch,
          reason: tabEvent.reason,
        });
        break;
      case 'engine-replaced':
        replacements.add(tabEvent.ownerEpoch);
        break;
      case 'cache-push':
        pushes.set(envelope.tabId, (pushes.get(envelope.tabId) ?? 0) + 1);
        break;
      case 'protocol-error':
        protocolErrors.push(tabEvent.error);
        break;
      case 'command-result': {
        const pending = pendingCommands.get(tabEvent.commandId);
        if (!pending) return;
        pendingCommands.delete(tabEvent.commandId);
        clearTimeout(pending.timer);
        if (tabEvent.ok) pending.resolve(tabEvent.result);
        else pending.reject(new Error(tabEvent.error));
        break;
      }
    }
  };
  telemetryChannel.onmessage = (event: MessageEvent<EngineTelemetry>) => {
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
        reject(new Error(`command timed out: ${value.kind}`));
      }, 20_000);
      pendingCommands.set(commandId, { resolve, reject, timer });
    });
    tabChannel.postMessage({
      source: 'harness',
      targetTabId,
      command: { ...value, commandId } as BrowserHarnessCommand,
    } satisfies BrowserHarnessEnvelope);
    return await result;
  };

  const latestOwner = (minimumEpoch = 0) =>
    workers.toReversed().find((worker) => worker.ownerEpoch >= minimumEpoch);

  const ownerLockName = (): string | undefined => {
    if (!latestOwner()) return;
    return databaseOwnerLockName(scope);
  };

  const verifyOwnerLock = async (ownerEpoch: number): Promise<void> => {
    const lockName = ownerLockName();
    assert(lockName, 'missing owner lock name');
    const locks = await navigator.locks.query();
    const held = locks.held?.filter((lock) => lock.name === lockName) ?? [];
    assert(
      held.length === 1,
      `epoch ${ownerEpoch} did not hold one owner lock`
    );
    const unavailable = await navigator.locks.request(
      lockName,
      { mode: 'exclusive', ifAvailable: true },
      (lock) => lock === null
    );
    assert(unavailable, `epoch ${ownerEpoch} owner lock was not exclusive`);
  };

  for (const tabId of tabIds) {
    const url = new URL('./tab.html', location.href);
    url.searchParams.set('scope', scope);
    url.searchParams.set('tabId', tabId);
    const popup = window.open(url, `${scope}:${tabId}`);
    if (!popup) throw new Error(`popup blocked for ${tabId}`);
    popups.set(tabId, popup);
  }

  await waitUntil('three adapters', () => adapterCreated.size === 3);
  await waitUntil('three registrations', () => registered.size === 3);
  await waitUntil('epoch 1 ready', () =>
    telemetry.some((event) => event.kind === 'ready' && event.ownerEpoch === 1)
  );
  assert(workers.length === 1, 'standby page eagerly created a worker');
  for (const tabId of tabIds) {
    assert(
      eventOrder.get(tabId)?.[0] === 'adapter-created',
      `${tabId} created a worker before its lazy adapter`
    );
  }
  await waitUntil(
    'three colliding init requests',
    () =>
      telemetry.filter(
        (event) =>
          event.kind === 'request-started' && event.requestKind === 'init'
      ).length >= 3
  );
  const routedInitIds = new Set(
    telemetry
      .filter(
        (event) =>
          event.kind === 'request-started' && event.requestKind === 'init'
      )
      .map((event) => event.requestId)
  );
  assert(
    routedInitIds.size === 3,
    'colliding tab request ids were not rewritten'
  );
  await verifyOwnerLock(1);

  const first = latestOwner(1);
  assert(first, 'missing epoch 1 owner');
  const firstStandbys = tabIds.filter((tabId) => tabId !== first.tabId);
  await command(firstStandbys[0]!, { kind: 'write', value: 'preserved' });
  await waitUntil('cache push fanout', () =>
    tabIds.every((tabId) => (pushes.get(tabId) ?? 0) > 0)
  );
  expectHit(await command(firstStandbys[1]!, { kind: 'read' }), 'preserved');

  await command(first.tabId, { kind: 'graceful-close' });
  await waitUntil('epoch 2 ready', () =>
    telemetry.some((event) => event.kind === 'ready' && event.ownerEpoch === 2)
  );
  const second = latestOwner(2);
  assert(second, 'missing epoch 2 owner');
  assert(second.tabId !== first.tabId, 'graceful handoff reused retiring tab');
  await verifyOwnerLock(2);
  expectHit(await command(second.tabId, { kind: 'read' }), 'preserved');

  await command(second.tabId, { kind: 'write', value: 'must-wipe' });
  const requester = tabIds.find(
    (tabId) => tabId !== first.tabId && tabId !== second.tabId
  );
  assert(requester, 'missing abrupt-loss requester');
  const slow = command(requester, { kind: 'slow-read' }).then(
    () => '',
    (error: unknown) => (error instanceof Error ? error.message : String(error))
  );
  await waitUntil('slow route start', () =>
    telemetry.some(
      (event) =>
        event.kind === 'request-started' &&
        event.ownerEpoch === 2 &&
        event.slow === true
    )
  );
  const oldRoute = telemetry.find(
    (event) =>
      event.kind === 'request-started' &&
      event.ownerEpoch === 2 &&
      event.slow === true
  );
  assert(oldRoute?.routeId, 'missing old route id');
  const secondPage = popups.get(second.tabId);
  assert(secondPage && !secondPage.closed, 'abrupt owner page closed early');
  await command(second.tabId, { kind: 'crash-worker' });
  await waitUntil('epoch 2 worker termination', () =>
    terminated.some((event) => event.ownerEpoch === 2)
  );
  const abruptError = await slow;
  assert(
    abruptError.includes('owner epoch 2 was lost'),
    'old route was not rejected'
  );
  assert(!secondPage.closed, 'worker-only failure closed its page');
  try {
    await waitUntil(
      'epoch 3 wipe and ready',
      () =>
        telemetry.some(
          (event) => event.kind === 'wipe-completed' && event.ownerEpoch === 3
        ) &&
        telemetry.some(
          (event) => event.kind === 'ready' && event.ownerEpoch === 3
        )
    );
  } catch (error) {
    const locks = await navigator.locks.query();
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}; workers=${JSON.stringify(workers)}; telemetry=${JSON.stringify(telemetry.slice(-20))}; events=${JSON.stringify(Object.fromEntries(eventOrder))}; locks=${JSON.stringify(locks)}; protocol=${JSON.stringify(protocolErrors)}`
    );
  }
  const third = latestOwner(3);
  assert(third, 'missing epoch 3 owner');
  await verifyOwnerLock(3);
  expectMiss(await command(third.tabId, { kind: 'read' }));

  await command(third.tabId, {
    kind: 'stale-response',
    ownerEpoch: 3,
    routeId: oldRoute.routeId,
  });
  await waitUntil('coordinator stale-message telemetry', () =>
    telemetry.some(
      (event) =>
        event.kind === 'coordinator-snapshot' &&
        (event.snapshot?.staleMessageDrops ?? 0) > 0
    )
  );
  expectMiss(await command(third.tabId, { kind: 'read' }));

  await command(third.tabId, { kind: 'write', value: 'liveness-wipe' });
  const thirdPage = popups.get(third.tabId);
  assert(thirdPage && !thirdPage.closed, 'liveness owner page closed early');
  await command(third.tabId, { kind: 'release-liveness-lock' });
  await waitUntil('epoch 3 liveness termination', () =>
    terminated.some(
      (event) =>
        event.ownerEpoch === 3 &&
        event.reason === 'tab liveness lock was released'
    )
  );
  assert(!thirdPage.closed, 'liveness lock release closed its page');
  await waitUntil(
    'epoch 4 wipe and ready',
    () =>
      telemetry.some(
        (event) => event.kind === 'wipe-completed' && event.ownerEpoch === 4
      ) &&
      telemetry.some(
        (event) => event.kind === 'ready' && event.ownerEpoch === 4
      )
  );
  const fourth = latestOwner(4);
  assert(fourth, 'missing epoch 4 owner');
  await verifyOwnerLock(4);
  expectMiss(await command(fourth.tabId, { kind: 'read' }));

  const result = {
    passed: true,
    openedTabs: 3,
    ownerEpochs: workers.map((worker) => worker.ownerEpoch),
    ownerTabs: workers.map((worker) => worker.tabId),
    maxWorkersPerEpoch: Math.max(
      ...workers.map(
        ({ ownerEpoch }) =>
          workers.filter((worker) => worker.ownerEpoch === ownerEpoch).length
      )
    ),
    noEagerWorker: true,
    collidingRequestIdsRewritten: true,
    gracefulPreserved: true,
    abruptRejectedInflight: abruptError.includes('owner epoch 2 was lost'),
    abruptWiped: true,
    workerOnlyPageStayedAlive: !secondPage.closed,
    workerOnlyWiped: true,
    livenessPageStayedAlive: !thirdPage.closed,
    livenessTerminationReason: terminated.find(
      (event) => event.ownerEpoch === 3
    )?.reason,
    livenessWiped: true,
    staleMessageDrops: Math.max(
      0,
      ...telemetry.map((event) => event.snapshot?.staleMessageDrops ?? 0)
    ),
    staleMessagePortResponseDropped: telemetry.some(
      (event) => (event.snapshot?.staleMessageDrops ?? 0) > 0
    ),
    pushReachedAllTabs: tabIds.every((tabId) => (pushes.get(tabId) ?? 0) > 0),
    ownerLockContentionEpochs: [1, 2, 3, 4],
    engineReplacedEpochs: [...replacements].toSorted(),
    protocolErrors,
  };

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
      (value as { data?: { value?: unknown } }).data?.value === expected,
    `expected cache hit ${expected}`
  );
}

function expectMiss(value: unknown): void {
  assert(
    typeof value === 'object' &&
      value !== null &&
      (value as { kind?: unknown }).kind === 'miss',
    'expected cache miss'
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
