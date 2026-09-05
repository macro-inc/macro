import type { CacheRequest } from '../../protocol';
import type {
  ProductionCacheRequestWithoutId,
  ProductionHarnessCommand,
  ProductionHarnessEnvelope,
} from './production-browser-wire';

const resultElement = document.querySelector<HTMLElement>('#result');
if (!resultElement) throw new Error('missing Cache internal result element');

export const CACHE_MUTATING_REQUEST_KINDS = [
  'write',
  'enqueue-optimistic-mutation',
  'claim-next-mutation',
  'defer-optimistic-write',
  'commit-optimistic-write',
  'rollback-optimistic-write',
  'invalidate',
  'delete-records',
  'clear',
] as const satisfies readonly CacheRequest['kind'][];

type MutatingRequestKind = (typeof CACHE_MUTATING_REQUEST_KINDS)[number];
type RecoveryKind = 'incompatible-namespace' | 'corrupt-queue-payload';
type CommandWithoutId = ProductionHarnessCommand extends infer Command
  ? Command extends ProductionHarnessCommand
    ? Omit<Command, 'commandId'>
    : never
  : never;

type RuntimeTelemetry = {
  kind: string;
  tabId?: string;
  ownerEpoch?: number;
  requestId?: number;
  requestKind?: string;
  databaseAction?: string;
  performanceMemoryAvailable?: boolean;
  userAgentSpecificMemoryAvailable?: boolean;
  admissionBarrier?: boolean;
  fatalCode?: string;
};

type QueueTelemetry = {
  name?: string;
  openOutcome?: string;
  queueDepth?: number;
  oldestAgeMs?: number;
};

const QUERY = `query Soup($input: SoupInput!) {
  user {
    id
    soup(input: $input) {
      nextCursor
      items { __typename id }
    }
  }
}`;
const MUTATION = `mutation SetEntityProperty($input: SetEntityPropertyInput!) {
  setEntityProperty(input: $input) { id displayName }
}`;
const VARIABLES = { input: { limit: 1 } };
const MUTATION_VARIABLES = {
  input: {
    entityType: 'DOCUMENT',
    entityId: 'doc-1',
    propertyDefinitionId: 'def-1',
    value: { string: 'x' },
  },
};

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

class ProductionSession {
  readonly runtimeTelemetry: RuntimeTelemetry[] = [];
  readonly cacheTelemetry: QueueTelemetry[] = [];
  private readonly tabs = new Map<string, HTMLIFrameElement>();
  private readonly registered = new Set<string>();
  private readonly pending = new Map<
    string,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private readonly tabChannel: BroadcastChannel;
  private readonly runtimeChannel: BroadcastChannel;
  private readonly cacheTelemetryChannel = new BroadcastChannel(
    'macro:graphql-cache-telemetry:v1'
  );

  constructor(readonly scope: string) {
    this.tabChannel = new BroadcastChannel(
      `graphql-cache-wp08-production-tabs:${scope}`
    );
    this.runtimeChannel = new BroadcastChannel(
      `graphql-cache-wp08-production:${scope}`
    );
    this.tabChannel.onmessage = (
      event: MessageEvent<ProductionHarnessEnvelope>
    ) => {
      const envelope = event.data;
      if (envelope.source !== 'tab') return;
      switch (envelope.event.kind) {
        case 'registered':
          this.registered.add(envelope.tabId);
          break;
        case 'command-result': {
          const pending = this.pending.get(envelope.event.commandId);
          if (!pending) return;
          this.pending.delete(envelope.event.commandId);
          clearTimeout(pending.timer);
          if (envelope.event.ok) pending.resolve(envelope.event.result);
          else pending.reject(new Error(envelope.event.error));
          break;
        }
        case 'protocol-error':
          throw new Error(envelope.event.error);
      }
    };
    this.runtimeChannel.onmessage = (event: MessageEvent<RuntimeTelemetry>) => {
      this.runtimeTelemetry.push(event.data);
    };
    this.cacheTelemetryChannel.onmessage = (
      event: MessageEvent<QueueTelemetry>
    ) => {
      this.cacheTelemetry.push(event.data);
    };
  }

  async openTab(tabId: string): Promise<void> {
    const readyBefore = this.runtimeTelemetry.filter(
      (event) => event.kind === 'ready'
    ).length;
    const url = new URL('./production-tab.html', location.href);
    url.searchParams.set('scope', this.scope);
    url.searchParams.set('tabId', tabId);
    const frame = document.createElement('iframe');
    frame.name = `${this.scope}:${tabId}`;
    frame.src = url.href;
    frame.hidden = true;
    document.body.append(frame);
    this.tabs.set(tabId, frame);
    await waitUntil(`${tabId} registration`, () => this.registered.has(tabId));
    await waitUntil(
      `${tabId} engine ready`,
      () =>
        this.runtimeTelemetry.filter((event) => event.kind === 'ready').length >
        readyBefore
    );
  }

  command(tabId: string, command: CommandWithoutId): Promise<unknown> {
    const commandId = crypto.randomUUID();
    const result = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(commandId);
        reject(new Error(`production command timed out: ${command.kind}`));
      }, 30_000);
      this.pending.set(commandId, { resolve, reject, timer });
    });
    this.tabChannel.postMessage({
      source: 'harness',
      targetTabId: tabId,
      command: { ...command, commandId } as ProductionHarnessCommand,
    } satisfies ProductionHarnessEnvelope);
    return result;
  }

  async gracefulClose(tabId: string): Promise<void> {
    const drainedBefore = this.runtimeTelemetry.filter(
      (event) => event.kind === 'drained'
    ).length;
    await this.command(tabId, { kind: 'graceful-close' });
    await waitUntil(
      `${tabId} graceful drain`,
      () =>
        this.runtimeTelemetry.filter((event) => event.kind === 'drained')
          .length > drainedBefore
    );
    this.tabs.get(tabId)?.remove();
    this.tabs.delete(tabId);
  }

  close(): void {
    for (const frame of this.tabs.values()) frame.remove();
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('production session closed'));
    }
    this.pending.clear();
    this.tabChannel.close();
    this.runtimeChannel.close();
    this.cacheTelemetryChannel.close();
  }
}

const writeRequest = (value: string): ProductionCacheRequestWithoutId => ({
  kind: 'write',
  query: QUERY,
  operationName: 'Soup',
  variables: VARIABLES,
  data: {
    user: {
      id: 'cache-recovery-user',
      soup: {
        nextCursor: null,
        items: [{ __typename: 'GraphqlSoupDocument', id: value }],
      },
    },
  },
  identity: 'cache-recovery-identity',
});

const enqueueRequest = (
  owner: string,
  createdAtMs: number
): ProductionCacheRequestWithoutId => ({
  kind: 'enqueue-optimistic-mutation',
  uuid: '00000000-0000-4000-8000-000000000011',
  query: MUTATION,
  operationName: 'SetEntityProperty',
  variables: MUTATION_VARIABLES,
  data: {
    setEntityProperty: { id: 'prop-1', displayName: 'Optimistic' },
  },
  createdAtMs,
  owner,
  nowMs: createdAtMs,
  leaseExpiresAtMs: createdAtMs + 1_000,
});

type SeededMutation = {
  transactionId: string;
  leaseOwner: string;
  leaseGeneration: string;
};

function seededMutation(value: unknown, owner: string): SeededMutation {
  assert(typeof value === 'object' && value !== null, 'missing enqueue result');
  const result = value as {
    transactionId?: unknown;
    initialClaim?: {
      kind?: unknown;
      mutation?: { leaseGeneration?: unknown };
    };
  };
  assert(typeof result.transactionId === 'string', 'missing transaction id');
  assert(
    result.initialClaim?.kind === 'claimed',
    'seed mutation was not claimed'
  );
  assert(
    typeof result.initialClaim.mutation?.leaseGeneration === 'string',
    'missing lease generation'
  );
  return {
    transactionId: result.transactionId,
    leaseOwner: owner,
    leaseGeneration: result.initialClaim.mutation.leaseGeneration,
  };
}

const blockedRequest = (
  kind: MutatingRequestKind,
  seed: SeededMutation
): ProductionCacheRequestWithoutId => {
  switch (kind) {
    case 'write':
      return writeRequest('blocked-write');
    case 'enqueue-optimistic-mutation':
      return enqueueRequest('blocked-enqueue-owner', 20);
    case 'claim-next-mutation':
      return {
        kind,
        owner: 'blocked-claim-owner',
        nowMs: 2_000,
        leaseExpiresAtMs: 3_000,
      };
    case 'defer-optimistic-write':
      return {
        kind,
        ...seed,
        nextAttemptAtMs: 5_000,
        error: 'browser-test-retry',
      };
    case 'commit-optimistic-write':
      return {
        kind,
        ...seed,
        query: MUTATION,
        operationName: 'SetEntityProperty',
        variables: MUTATION_VARIABLES,
        data: {
          setEntityProperty: { id: 'prop-1', displayName: 'Committed' },
        },
      };
    case 'rollback-optimistic-write':
      return { kind, ...seed, error: 'browser-test-permanent' };
    case 'invalidate':
    case 'delete-records':
      return { kind, keys: ['GraphqlSoupDocument:seed-record'] };
    case 'clear':
      return { kind };
  }
};

const isMiss = (value: unknown): boolean =>
  typeof value === 'object' &&
  value !== null &&
  (value as { kind?: unknown }).kind === 'miss';

const isHit = (value: unknown): boolean =>
  typeof value === 'object' &&
  value !== null &&
  (value as { kind?: unknown }).kind === 'hit';

const admissionBarrierRequest = (): ProductionCacheRequestWithoutId => ({
  kind: 'read',
  query: QUERY.replace('query Soup', 'query CacheAdmissionBarrier'),
  operationName: 'CacheAdmissionBarrier',
  variables: VARIABLES,
});

async function runFaultKind(kind: MutatingRequestKind) {
  assert(
    CACHE_MUTATING_REQUEST_KINDS.includes(kind),
    `unsupported mutating request kind ${kind}`
  );
  const session = new ProductionSession(
    `cache-recovery-fault-${kind}-${crypto.randomUUID()}`
  );
  try {
    await session.openTab('fault-tab');
    await session.command('fault-tab', {
      kind: 'request',
      request: writeRequest('seed-record'),
    });
    const owner = `seed-owner-${kind}`;
    const seed = seededMutation(
      await session.command('fault-tab', {
        kind: 'request',
        request: enqueueRequest(owner, 10),
      }),
      owner
    );
    await session.command('fault-tab', {
      kind: 'arm-mutation-block',
      requestKind: kind,
    });
    await waitUntil('mutation block arm proof', () =>
      session.runtimeTelemetry.some(
        (event) =>
          event.kind === 'mutation-block-armed' && event.requestKind === kind
      )
    );
    const armIndex = session.runtimeTelemetry.findIndex(
      (event) =>
        event.kind === 'mutation-block-armed' && event.requestKind === kind
    );
    const oldRequest = session
      .command('fault-tab', {
        kind: 'request',
        request: blockedRequest(kind, seed),
      })
      .then(
        () => ({ rejected: false, error: '' }),
        (error: unknown) => ({
          rejected: true,
          error: error instanceof Error ? error.message : String(error),
        })
      );
    await waitUntil('request admitted and blocked before core', () =>
      session.runtimeTelemetry.some(
        (event) =>
          event.kind === 'request-blocked-before-core' &&
          event.requestKind === kind
      )
    );
    const blocked = session.runtimeTelemetry.find(
      (event) =>
        event.kind === 'request-blocked-before-core' &&
        event.requestKind === kind
    );
    assert(blocked?.requestId !== undefined, 'missing blocked request id');
    const readyBefore = session.runtimeTelemetry.filter(
      (event) => event.kind === 'ready'
    ).length;
    const telemetryBeforeLoss = session.cacheTelemetry.length;
    await session.command('fault-tab', { kind: 'terminate-worker' });
    const old = await oldRequest;
    assert(old.rejected, 'old admitted request did not reject');
    await waitUntil(
      'replacement ready after actual worker termination',
      () =>
        session.runtimeTelemetry.filter((event) => event.kind === 'ready')
          .length > readyBefore
    );
    const replacementReadyIndex = session.runtimeTelemetry.findLastIndex(
      (event) => event.kind === 'ready'
    );
    assert(replacementReadyIndex > armIndex, 'missing replacement ready index');
    await session.command('fault-tab', {
      kind: 'request',
      request: admissionBarrierRequest(),
    });
    await waitUntil('replacement request-admission barrier', () =>
      session.runtimeTelemetry
        .slice(replacementReadyIndex + 1)
        .some((event) => event.admissionBarrier === true)
    );
    const barrierIndex = session.runtimeTelemetry.findIndex(
      (event, index) =>
        index > replacementReadyIndex && event.admissionBarrier === true
    );
    assert(barrierIndex > replacementReadyIndex, 'missing admission barrier');
    const mutationAdmissions = session.runtimeTelemetry
      .slice(armIndex, replacementReadyIndex + 1)
      .filter(
        (event) =>
          event.kind === 'request-admitted' && event.requestKind === kind
      );
    assert(mutationAdmissions.length === 1, 'mutating request was replayed');
    assert(
      mutationAdmissions[0]?.requestId === blocked.requestId,
      'blocked admission proof did not identify the routed request'
    );
    const mutatingKinds = new Set<string>(CACHE_MUTATING_REQUEST_KINDS);
    const unexpectedReplacementMutatingAdmissions = session.runtimeTelemetry
      .slice(replacementReadyIndex + 1, barrierIndex + 1)
      .filter(
        (event) =>
          event.kind === 'request-admitted' &&
          mutatingKinds.has(String(event.requestKind))
      );
    assert(
      unexpectedReplacementMutatingAdmissions.length === 0,
      'replacement admitted unexpected replayed mutation work'
    );

    const replacementRead = await session.command('fault-tab', {
      kind: 'request',
      request: {
        kind: 'read',
        query: QUERY,
        operationName: 'Soup',
        variables: VARIABLES,
      },
    });
    const replacementClaim = await session.command('fault-tab', {
      kind: 'request',
      request: {
        kind: 'claim-next-mutation',
        owner: 'replacement-probe',
        nowMs: 10_000,
        leaseExpiresAtMs: 11_000,
      },
    });
    assert(isMiss(replacementRead), 'replacement retained a durable record');
    assert(
      replacementClaim === undefined || replacementClaim === null,
      'replacement retained the durable queue'
    );
    const ready = session.runtimeTelemetry
      .filter((event) => event.kind === 'ready')
      .at(-1);
    await waitUntil('authoritative reset phase sequence', () =>
      session.cacheTelemetry
        .slice(telemetryBeforeLoss)
        .some((event) => event.name === 'graphql_cache.reset_wipe')
    );
    const resetTelemetry = session.cacheTelemetry.slice(telemetryBeforeLoss);
    const resetPhaseSequence = resetTelemetry
      .filter((event) =>
        [
          'graphql_cache.storage_reset_required',
          'graphql_cache.logical_reset',
          'graphql_cache.reset_wipe',
        ].includes(String(event.name))
      )
      .map((event) => event.name);
    assert(
      JSON.stringify(resetPhaseSequence) ===
        JSON.stringify([
          'graphql_cache.storage_reset_required',
          'graphql_cache.logical_reset',
          'graphql_cache.reset_wipe',
        ]),
      `unexpected reset phase sequence ${JSON.stringify(resetPhaseSequence)}`
    );
    await session.gracefulClose('fault-tab');
    return {
      kind,
      actualDedicatedWorkerTerminated: true,
      requestAdmittedBeforeCore: true,
      midSqlExecutionClaimed: false,
      oldRequestRejected: old.rejected,
      replacementRecordsEmpty: true,
      replacementQueueEmpty: true,
      mutationAdmissionCount: mutationAdmissions.length,
      unexpectedReplacementMutatingAdmissionCount:
        unexpectedReplacementMutatingAdmissions.length,
      replacementAdmissionBarrierObserved: true,
      resetPhaseSequence,
      exactProductionTursoWasm: true,
      performanceMemoryAvailable: ready?.performanceMemoryAvailable ?? false,
      userAgentSpecificMemoryAvailable:
        ready?.userAgentSpecificMemoryAvailable ?? false,
      queueTelemetryObserved: session.cacheTelemetry.some(
        (event) =>
          event.name === 'graphql_cache.queue_diagnostics' &&
          event.queueDepth === 0
      ),
    };
  } finally {
    session.close();
  }
}

async function applyStorageMutation(
  scope: string,
  kind: RecoveryKind
): Promise<string> {
  const worker = new Worker(
    new URL('./production-cache.storage-control-worker.ts', import.meta.url),
    { type: 'module', name: `cache-recovery-storage-control:${kind}` }
  );
  try {
    return await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('storage-control worker timed out')),
        30_000
      );
      worker.onmessage = (
        event: MessageEvent<{
          id: number;
          ok: boolean;
          wasmUrl?: string;
          error?: string;
        }>
      ) => {
        if (event.data.id !== 1) return;
        clearTimeout(timeout);
        if (event.data.ok && event.data.wasmUrl) resolve(event.data.wasmUrl);
        else reject(new Error(event.data.error ?? 'storage-control failed'));
      };
      worker.onerror = (event) => {
        clearTimeout(timeout);
        reject(new Error(event.message));
      };
      worker.postMessage({ id: 1, scope, kind });
    });
  } finally {
    worker.terminate();
  }
}

async function runRecoveryKind(kind: RecoveryKind) {
  const scope = `cache-recovery-${kind}-${crypto.randomUUID()}`;
  const session = new ProductionSession(scope);
  try {
    await session.openTab('before-corruption');
    await session.command('before-corruption', {
      kind: 'request',
      request: writeRequest('must-reset'),
    });
    await session.command('before-corruption', {
      kind: 'request',
      request: enqueueRequest('recovery-seed-owner', 10),
    });
    await session.gracefulClose('before-corruption');
    const browserTestWasmUrl = await applyStorageMutation(scope, kind);
    const telemetryBeforeReopen = session.cacheTelemetry.length;
    await session.openTab('after-corruption');
    await waitUntil('recovery outcome and authoritative wipe telemetry', () => {
      const events = session.cacheTelemetry.slice(telemetryBeforeReopen);
      return (
        events.some((event) =>
          String(event.openOutcome).startsWith('reset-')
        ) && events.some((event) => event.name === 'graphql_cache.reset_wipe')
      );
    });
    const replacementTelemetry = session.cacheTelemetry.slice(
      telemetryBeforeReopen
    );
    const expectedOutcome =
      kind === 'incompatible-namespace'
        ? 'reset-incompatible'
        : 'reset-corrupt';
    const replacementRead = await session.command('after-corruption', {
      kind: 'request',
      request: {
        kind: 'read',
        query: QUERY,
        operationName: 'Soup',
        variables: VARIABLES,
      },
    });
    const replacementClaim = await session.command('after-corruption', {
      kind: 'request',
      request: {
        kind: 'claim-next-mutation',
        owner: 'recovery-probe',
        nowMs: 10_000,
        leaseExpiresAtMs: 11_000,
      },
    });
    assert(isMiss(replacementRead), 'recovery retained a durable record');
    assert(
      replacementClaim === undefined || replacementClaim === null,
      'recovery retained the durable queue'
    );
    await session.command('after-corruption', {
      kind: 'request',
      request: writeRequest('usable-after-reset'),
    });
    const usableRead = await session.command('after-corruption', {
      kind: 'request',
      request: {
        kind: 'read',
        query: QUERY,
        operationName: 'Soup',
        variables: VARIABLES,
      },
    });
    assert(isHit(usableRead), 'recovered cache was not usable');
    const phaseCount = (name: string): number =>
      replacementTelemetry.filter((event) => event.name === name).length;
    assert(
      replacementTelemetry.some(
        (event) => event.openOutcome === expectedOutcome
      ),
      `missing ${expectedOutcome} telemetry`
    );
    for (const phase of [
      'graphql_cache.storage_reset_required',
      'graphql_cache.logical_reset',
      'graphql_cache.reset_wipe',
    ]) {
      assert(phaseCount(phase) === 1, `${phase} was not emitted exactly once`);
    }
    await session.gracefulClose('after-corruption');
    return {
      kind,
      gracefulCloseBeforeMutation: true,
      separateFeatureGatedBrowserTestArtifact: true,
      productionArtifactDebugExportsAbsent: true,
      browserTestWasmUrl,
      browserTestWorkerOnlyControl: true,
      productionCoordinatorProtocolUnchanged: true,
      openOutcome: expectedOutcome,
      recordsWiped: true,
      durableQueueWiped: true,
      usableAfterReset: true,
      storageResetRequiredCount: phaseCount(
        'graphql_cache.storage_reset_required'
      ),
      logicalResetCount: phaseCount('graphql_cache.logical_reset'),
      resetWipeCount: phaseCount('graphql_cache.reset_wipe'),
      queueTelemetryObserved: replacementTelemetry.some(
        (event) =>
          event.name === 'graphql_cache.queue_diagnostics' &&
          event.queueDepth === 0
      ),
    };
  } finally {
    session.close();
  }
}

const api = {
  mutatingRequestKinds: CACHE_MUTATING_REQUEST_KINDS,
  runFaultKind,
  runRecoveryKind,
};

declare global {
  interface Window {
    cacheRecoveryHarness: typeof api;
  }
}

window.cacheRecoveryHarness = api;
resultElement.dataset.status = 'ready';
resultElement.textContent = JSON.stringify({
  productionInertHooks: true,
  publicCoordinatorProtocolUnchanged: true,
  mutatingRequestKinds: CACHE_MUTATING_REQUEST_KINDS,
});
