import type {
  ProductionHarnessCommand,
  ProductionHarnessEnvelope,
} from './production-browser-wire';

// Tabs of three simulated builds share one scope. Each build runs its own
// coordinator over the one database, as deployed builds do. The newer build
// must take the database over without wiping it, and send the older build's
// tabs on; an even older build must be turned away.

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
};

const BUILDS = { older: 500, old: 1_000, new: 2_000 } as const;

const assert: (condition: unknown, message: string) => asserts condition = (
  condition,
  message
) => {
  if (!condition) throw new Error(message);
};

const waitUntil = async (
  description: string,
  predicate: () => boolean,
  timeoutMs = 30_000
): Promise<void> => {
  const started = performance.now();
  while (!predicate()) {
    if (performance.now() - started > timeoutMs) {
      throw new Error(`timed out waiting for ${description}`);
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
  }
};

const run = async (): Promise<Record<string, unknown>> => {
  const scope = `takeover-${crypto.randomUUID()}`;
  const tabChannel = new BroadcastChannel(
    `graphql-cache-wp08-production-tabs:${scope}`
  );
  const telemetryChannel = new BroadcastChannel(
    `graphql-cache-wp08-production:${scope}`
  );
  const popups = new Map<string, Window>();
  const registered = new Set<string>();
  const superseded = new Map<string, string>();
  const unavailable = new Map<string, string>();
  const terminated: Array<{ tabId: string; reason: string }> = [];
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
      case 'cache-superseded':
        superseded.set(message.tabId, message.event.reason);
        break;
      case 'cache-unavailable':
        unavailable.set(message.tabId, message.event.reason);
        break;
      case 'worker-terminated':
        terminated.push({
          tabId: message.tabId,
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
        reject(new Error(`takeover command timed out: ${value.kind}`));
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

  const openTab = (tabId: string, build: keyof typeof BUILDS): void => {
    const url = new URL('./production-tab.html', location.href);
    url.searchParams.set('scope', scope);
    url.searchParams.set('tabId', tabId);
    url.searchParams.set('build', build);
    url.searchParams.set('buildTime', String(BUILDS[build]));
    const popup = window.open(url, `${scope}:${tabId}`);
    if (!popup) throw new Error(`popup blocked for ${tabId}`);
    popups.set(tabId, popup);
  };

  const readyFor = (tabId: string) =>
    telemetry.find((event) => event.kind === 'ready' && event.tabId === tabId);

  // The old build owns the database and holds data.
  openTab('old-a', 'old');
  openTab('old-b', 'old');
  await waitUntil('both old-build tabs to register', () =>
    ['old-a', 'old-b'].every((tabId) => registered.has(tabId))
  );
  await waitUntil('the old build to open the database', () =>
    ['old-a', 'old-b'].some((tabId) => readyFor(tabId))
  );
  const oldOwner = ['old-a', 'old-b'].find((tabId) => readyFor(tabId));
  assert(oldOwner, 'missing old-build owner');
  await command('old-b', { kind: 'write', value: 'takeover-preserved' });

  // A tab of the newer build opens and takes the database over.
  openTab('new-a', 'new');
  await waitUntil('the new build to open the database', () =>
    Boolean(readyFor('new-a'))
  );
  expectHit(await command('new-a', { kind: 'read' }), 'takeover-preserved');
  await waitUntil('both old-build tabs to be sent on', () =>
    ['old-a', 'old-b'].every((tabId) => superseded.has(tabId))
  );

  // A tab of an even older build is turned away; the new build keeps it.
  openTab('older-a', 'older');
  await waitUntil('the older-build tab to be told to run uncached', () =>
    unavailable.has('older-a')
  );
  const olderBuildSentOn = superseded.has('older-a');
  // A page of the old build that loads after the handover, as after a
  // rollback, runs uncached rather than reloading, which could land on the
  // old build again. Its coordinator either was superseded or, once the old
  // tabs let it go, starts fresh and is turned away by the newer build.
  openTab('old-c', 'old');
  await waitUntil('the late old-build tab to be told to run uncached', () =>
    unavailable.has('old-c')
  );
  expectHit(await command('new-a', { kind: 'read' }), 'takeover-preserved');

  const result = {
    passed: true,
    newBuildDatabaseAction: telemetry.find(
      (event) => event.kind === 'activation-started' && event.tabId === 'new-a'
    )?.databaseAction,
    newBuildKeptData: true,
    // The old owner stopped its engine the way a navigating page does.
    oldEngineStoppedLikeNavigation:
      terminated.find((event) => event.tabId === oldOwner)?.reason ===
      'page navigation',
    oldTabsSentOn: ['old-a', 'old-b'].every((tabId) =>
      superseded.get(tabId)?.includes('newer version of the app')
    ),
    olderBuildTurnedAway:
      unavailable.get('older-a')?.includes('owner lock is held') ?? false,
    olderBuildSentOn,
    lateOldTabRunsUncached: unavailable.has('old-c'),
    lateOldTabSentOn: superseded.has('old-c'),
    newBuildSentOn: superseded.has('new-a'),
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
    // Firefox stacks leave out the message.
    resultElement.textContent =
      error instanceof Error
        ? `${error.message}\n${error.stack ?? ''}`
        : String(error);
  }
})();
