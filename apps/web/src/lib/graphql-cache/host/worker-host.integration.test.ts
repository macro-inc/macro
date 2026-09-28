import {
  type Client,
  gql,
  makeOperation,
  type Operation,
  type OperationResult,
} from '@urql/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeSubject, pipe, type Source, subscribe } from 'wonka';
import { normalizedCacheExchange } from '../exchange/normalized-cache-exchange';
import type { CacheRequest, CacheResponse } from '../protocol';
import { installCacheCoordinatorWorker } from '../worker/cache-coordinator-runtime';
import { installCacheEngineWorker } from '../worker/cache-engine-runtime';
import { CoordinatorRouter } from '../worker/coordinator-router';
import type { CacheHost } from './types';
import { createWorkerCacheHost } from './worker-host';

const PAGEHIDE_MUTATION = gql`
  mutation HoldPagehide {
    holdPagehide
  }
`;
const STANDBY_MUTATION = gql`
  mutation HoldStandby {
    holdStandby
  }
`;
const RETIREMENT_FAILURE_MUTATION = gql`
  mutation HoldRetirementFailure {
    holdRetirementFailure
  }
`;

function exchangeHarness(host: CacheHost, operation: Operation) {
  const operations = makeSubject<Operation>();
  const network = makeSubject<OperationResult>();
  const forwarded: Operation[] = [];
  const results: OperationResult[] = [];
  const client = { reexecuteOperation: vi.fn() } as unknown as Client;
  const forward = (source: Source<Operation>): Source<OperationResult> => {
    pipe(
      source,
      subscribe((forwardedOperation) => forwarded.push(forwardedOperation))
    );
    return network.source;
  };
  pipe(
    normalizedCacheExchange(host)({
      forward,
      client,
      dispatchDebug: () => undefined,
    })(operations.source),
    subscribe((result) => results.push(result))
  );
  operations.next(operation);
  return { forwarded, results };
}

function optimisticMutation(key: number, query: Operation['query']): Operation {
  return makeOperation('mutation', { key, query, variables: {} }, {
    requestPolicy: 'cache-first',
    url: 'http://integration.test',
    suspense: false,
    normalizedCacheOptimistic: {
      uuid: '00000000-0000-4000-8000-000000000001',
      optimisticResponse: { held: true },
    },
  } as never);
}

class LinkedMessagePort extends EventTarget {
  peer: LinkedMessagePort | undefined;
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  closed = false;

  postMessage(
    message: unknown,
    transfer: Transferable[] | StructuredSerializeOptions = []
  ): void {
    const peer = this.peer;
    if (this.closed || !peer || peer.closed) return;
    const ports = (
      Array.isArray(transfer) ? transfer : (transfer.transfer ?? [])
    ) as MessagePort[];
    queueMicrotask(() => {
      if (peer.closed) return;
      peer.onmessage?.({
        data: message,
        ports,
      } as unknown as MessageEvent);
      peer.dispatchEvent(new MessageEvent('message', { data: message, ports }));
    });
  }

  start(): void {}

  close(): void {
    this.closed = true;
  }
}

class LinkedMessageChannel {
  readonly port1 = new LinkedMessagePort();
  readonly port2 = new LinkedMessagePort();

  constructor() {
    this.port1.peer = this.port2;
    this.port2.peer = this.port1;
  }
}

type RuntimeLog = {
  epoch: number;
  kind: CacheRequest['kind'] | 'drain';
  id?: number;
  query?: string;
};

type Deferred = { promise: Promise<void>; resolve: () => void };
const deferred = (): Deferred => {
  let resolve!: () => void;
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
};

class IntegrationCore {
  constructor(
    private readonly epoch: number,
    private readonly logs: RuntimeLog[],
    private readonly activationGates: Map<number, Promise<void>>,
    private readonly hostInitGates: Map<number, Promise<void>>,
    private readonly enqueueGates: Map<string, Promise<void>>
  ) {}

  addPort(): void {}

  async handleRequest(
    port: { postMessage(message: unknown): void },
    request: CacheRequest
  ): Promise<void> {
    this.logs.push({
      epoch: this.epoch,
      kind: request.kind,
      id: request.id,
      query: 'query' in request ? request.query : undefined,
    });
    if (request.kind === 'init') {
      const gate =
        request.id === 0
          ? this.activationGates.get(this.epoch)
          : this.hostInitGates.get(this.epoch);
      if (gate) await gate;
    }
    if (request.kind === 'read' && request.query.includes('Slow')) {
      await new Promise<void>(() => undefined);
      return;
    }
    if (request.kind === 'enqueue-optimistic-mutation') {
      const gate = this.enqueueGates.get(request.operationName ?? '');
      if (gate) await gate;
    }
    let result: unknown = null;
    if (request.kind === 'read') result = { kind: 'miss' };
    if (request.kind === 'enqueue-optimistic-mutation') {
      result = {
        transactionId: `integration-${request.id}`,
        changed: [],
        affectedOps: [],
        reset: false,
        upsertKind: { kind: 'inserted' },
        initialClaim: { kind: 'not-runnable' },
      };
    }
    const response: CacheResponse = { id: request.id, ok: true, result };
    port.postMessage(response);
  }

  async drain(): Promise<void> {
    this.logs.push({ epoch: this.epoch, kind: 'drain' });
  }
}

class IntegrationWorkerScope {
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  closed = false;

  close(): void {
    this.closed = true;
  }
}

class IntegrationDedicatedWorker {
  onerror: ((this: AbstractWorker, event: ErrorEvent) => unknown) | null = null;
  onmessageerror: ((this: Worker, event: MessageEvent) => unknown) | null =
    null;
  readonly scope = new IntegrationWorkerScope();
  terminated = false;

  constructor(
    readonly epoch: number,
    logs: RuntimeLog[],
    activationGates: Map<number, Promise<void>>,
    hostInitGates: Map<number, Promise<void>>,
    enqueueGates: Map<string, Promise<void>>
  ) {
    installCacheEngineWorker({
      scope: this.scope,
      createCore: () =>
        new IntegrationCore(
          epoch,
          logs,
          activationGates,
          hostInitGates,
          enqueueGates
        ),
      ownerLockIsHeld: async () => true,
    });
  }

  postMessage(message: unknown, transfer: Transferable[]): void {
    this.scope.onmessage?.({
      data: message,
      ports: transfer,
    } as unknown as MessageEvent);
  }

  terminate(): void {
    this.terminated = true;
  }

  fail(message: string): void {
    this.onerror?.call(
      {} as AbstractWorker,
      { message, preventDefault: vi.fn() } as unknown as ErrorEvent
    );
  }
}

class IntegrationSharedWorker {
  onerror: ((this: AbstractWorker, event: ErrorEvent) => unknown) | null = null;
  readonly port: LinkedMessagePort;

  constructor(router: CoordinatorRouter) {
    const channel = new LinkedMessageChannel();
    this.port = channel.port1;
    installCacheCoordinatorWorker({
      endpoint: channel.port2 as unknown as MessagePort,
      router,
    });
  }

  fail(message: string): void {
    this.onerror?.call(
      {} as AbstractWorker,
      { message, preventDefault: vi.fn() } as unknown as ErrorEvent
    );
  }
}

describe('worker CacheHost coordinator integration', () => {
  const logs: RuntimeLog[] = [];
  const dedicatedWorkers: IntegrationDedicatedWorker[] = [];
  const sharedWorkers: IntegrationSharedWorker[] = [];
  const activationGates = new Map<number, Promise<void>>();
  const hostInitGates = new Map<number, Promise<void>>();
  const enqueueGates = new Map<string, Promise<void>>();

  beforeEach(() => {
    localStorage.clear();
    logs.length = 0;
    dedicatedWorkers.length = 0;
    sharedWorkers.length = 0;
    activationGates.clear();
    hostInitGates.clear();
    enqueueGates.clear();
    const router = new CoordinatorRouter({
      verifyTabLockHeld: async () => true,
      watchTabLock: () => () => undefined,
    });
    vi.stubGlobal('MessageChannel', LinkedMessageChannel);
    vi.stubGlobal(
      'SharedWorker',
      class {
        onerror: IntegrationSharedWorker['onerror'] = null;
        readonly port: LinkedMessagePort;

        constructor() {
          const worker = new IntegrationSharedWorker(router);
          sharedWorkers.push(worker);
          this.port = worker.port;
          Object.defineProperty(this, 'onerror', {
            get: () => worker.onerror,
            set: (value) => {
              worker.onerror = value;
            },
          });
        }
      }
    );
    vi.stubGlobal(
      'Worker',
      class {
        readonly delegate: IntegrationDedicatedWorker;

        constructor(_url: URL, options?: WorkerOptions) {
          const epoch = Number(options?.name?.split(':').at(-1));
          this.delegate = new IntegrationDedicatedWorker(
            epoch,
            logs,
            activationGates,
            hostInitGates,
            enqueueGates
          );
          dedicatedWorkers.push(this.delegate);
        }

        get onerror(): IntegrationDedicatedWorker['onerror'] {
          return this.delegate.onerror;
        }

        set onerror(value: IntegrationDedicatedWorker['onerror']) {
          this.delegate.onerror = value;
        }

        get onmessageerror(): IntegrationDedicatedWorker['onmessageerror'] {
          return this.delegate.onmessageerror;
        }

        set onmessageerror(value: IntegrationDedicatedWorker['onmessageerror'],) {
          this.delegate.onmessageerror = value;
        }

        postMessage(message: unknown, transfer: Transferable[]): void {
          this.delegate.postMessage(message, transfer);
        }

        terminate(): void {
          this.delegate.terminate();
        }
      }
    );
    vi.stubGlobal('navigator', {
      locks: {
        request: async (
          name: string,
          _options: LockOptions,
          callback: (lock: Lock | null) => unknown
        ) => await callback({ name, mode: 'exclusive' } as Lock),
      },
      storage: { getDirectory: vi.fn() },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('registers, replaces without replay or duplicate reread, and retires gracefully', async () => {
    const host = createWorkerCacheHost({
      scope: 'integration-scope',
      requestTimeoutMs: 1_000,
    });
    const order: string[] = [];
    let replacementRead: Promise<unknown> | undefined;
    host.onOpsAffected((keys) => {
      order.push(`affected:${keys.join(',')}`);
      replacementRead = host.readQuery({
        opKey: keys[0],
        query: 'query Replacement { replacement }',
      });
    });

    expect(sharedWorkers).toHaveLength(0);
    expect(dedicatedWorkers).toHaveLength(0);

    await expect(
      host.readQuery({ query: 'query Warm { warm }' })
    ).resolves.toEqual({ kind: 'miss' });
    await Promise.all([
      host.readQuery({ opKey: 7, query: 'query RegisteredSeven { seven }' }),
      host.readQuery({ opKey: 9, query: 'query RegisteredNine { nine }' }),
    ]);
    expect(sharedWorkers).toHaveLength(1);
    expect(dedicatedWorkers.map((worker) => worker.epoch)).toEqual([1]);

    const slowRead = host.readQuery({
      opKey: 7,
      query: 'query Slow { slow }',
    });
    const slowRejected = expect(slowRead).rejects.toMatchObject({
      errorCode: 'owner-epoch-lost',
    });
    void slowRead.catch(() => order.push('old-request-rejected'));
    await vi.waitFor(() =>
      expect(
        logs.filter(
          ({ epoch, query }) => epoch === 1 && query?.includes('Slow')
        )
      ).toHaveLength(1)
    );

    dedicatedWorkers[0]?.fail('integration engine loss');
    await slowRejected;
    await vi.waitFor(() => expect(order).toContain('affected:7,9'));
    await vi.waitFor(() => expect(replacementRead).toBeDefined());
    await expect(replacementRead).resolves.toEqual({ kind: 'miss' });

    expect(order).toEqual(['old-request-rejected', 'affected:7,9']);
    expect(dedicatedWorkers.map((worker) => worker.epoch)).toEqual([1, 2]);
    expect(dedicatedWorkers[0]?.terminated).toBe(true);
    expect(logs.filter(({ query }) => query?.includes('Slow'))).toHaveLength(1);
    expect(
      logs.filter(
        ({ epoch, kind, id }) => epoch === 2 && kind === 'init' && id !== 0
      )
    ).toHaveLength(1);
    expect(
      logs.filter(
        ({ epoch, query }) =>
          epoch === 2 && query === 'query Replacement { replacement }'
      )
    ).toHaveLength(1);

    host.dispose();
    await vi.waitFor(() => expect(dedicatedWorkers[1]?.terminated).toBe(true));
    expect(logs).toContainEqual({ epoch: 2, kind: 'drain' });
    expect(sharedWorkers[0]?.port.closed).toBe(true);
  });

  it('does not duplicate reads queued before or joined during replacement init', async () => {
    const activationGate = deferred();
    const hostInitGate = deferred();
    activationGates.set(2, activationGate.promise);
    hostInitGates.set(2, hostInitGate.promise);
    const host = createWorkerCacheHost({
      scope: 'integration-scope',
      requestTimeoutMs: 1_000,
    });
    const affected: number[][] = [];
    let replacementRead: Promise<unknown> | undefined;
    host.onOpsAffected((keys) => {
      affected.push(keys);
      replacementRead = host.readQuery({
        opKey: keys[0],
        query: 'query UntouchedReplacement { ten }',
      });
    });
    await Promise.all(
      [8, 9, 10].map((opKey) =>
        host.readQuery({
          opKey,
          query: `query Registered${opKey} { value${opKey} }`,
        })
      )
    );

    // No request from this host is in flight when the owner is lost, so the
    // host remains ready while the coordinator enters resetting/activating.
    dedicatedWorkers[0]?.fail('integration engine loss');
    await vi.waitFor(() =>
      expect(dedicatedWorkers.map(({ epoch }) => epoch)).toEqual([1, 2])
    );
    const queuedBefore = host.readQuery({
      opKey: 8,
      query: 'query QueuedBefore { eight }',
    });
    expect(
      logs.filter(
        ({ epoch, query }) => epoch === 2 && query?.includes('QueuedBefore')
      )
    ).toHaveLength(0);
    activationGate.resolve();
    await vi.waitFor(() =>
      expect(
        logs.filter(
          ({ epoch, kind, id }) => epoch === 2 && kind === 'init' && id !== 0
        )
      ).toHaveLength(1)
    );

    const joinedDuring = host.readQuery({
      opKey: 9,
      query: 'query JoinedDuring { nine }',
    });
    hostInitGate.resolve();
    await expect(queuedBefore).resolves.toEqual({ kind: 'miss' });
    await expect(joinedDuring).resolves.toEqual({ kind: 'miss' });
    await vi.waitFor(() => expect(affected).toEqual([[10]]));
    await vi.waitFor(() => expect(replacementRead).toBeDefined());
    await expect(replacementRead).resolves.toEqual({ kind: 'miss' });

    expect(
      logs.filter(
        ({ epoch, query }) => epoch === 2 && query?.includes('QueuedBefore')
      )
    ).toHaveLength(1);
    expect(
      logs.filter(
        ({ epoch, query }) => epoch === 2 && query?.includes('JoinedDuring')
      )
    ).toHaveLength(1);
    expect(
      logs.filter(
        ({ epoch, query }) =>
          epoch === 2 && query?.includes('UntouchedReplacement')
      )
    ).toHaveLength(1);
    host.dispose();
  });

  it('keeps API forwarding at zero and preserves scope when pagehide abandons an admitted enqueue', async () => {
    const gate = deferred();
    enqueueGates.set('HoldPagehide', gate.promise);
    localStorage.setItem('graphql-cache:scope', 'integration-scope');
    const host = createWorkerCacheHost({ scope: 'integration-scope' });
    const { forwarded, results } = exchangeHarness(
      host,
      optimisticMutation(101, PAGEHIDE_MUTATION)
    );
    await vi.waitFor(() =>
      expect(
        logs.filter(
          ({ kind, query }) =>
            kind === 'enqueue-optimistic-mutation' &&
            query?.includes('HoldPagehide')
        )
      ).toHaveLength(1)
    );

    dispatchEvent(new Event('pagehide'));
    await vi.waitFor(() => expect(results).toHaveLength(1));

    expect(forwarded).toHaveLength(0);
    expect(results[0]?.error?.networkError).toMatchObject({
      errorCode: 'admitted-enqueue-uncertain',
    });
    expect(localStorage.getItem('graphql-cache:scope')).toBe(
      'integration-scope'
    );
  });

  it('keeps a standby connected until its admitted enqueue response settles', async () => {
    const owner = createWorkerCacheHost({ scope: 'integration-scope' });
    await owner.readQuery({ query: 'query OwnerWarm { ownerWarm }' });
    const gate = deferred();
    enqueueGates.set('HoldStandby', gate.promise);
    const standby = createWorkerCacheHost({ scope: 'integration-scope' });
    const { forwarded, results } = exchangeHarness(
      standby,
      optimisticMutation(102, STANDBY_MUTATION)
    );
    await vi.waitFor(() =>
      expect(
        logs.filter(
          ({ kind, query }) =>
            kind === 'enqueue-optimistic-mutation' &&
            query?.includes('HoldStandby')
        )
      ).toHaveLength(1)
    );

    standby.dispose();
    expect(sharedWorkers[1]?.port.closed).toBe(false);
    gate.resolve();
    await vi.waitFor(() => expect(results).toHaveLength(1));
    await vi.waitFor(() => expect(sharedWorkers[1]?.port.closed).toBe(true));

    expect(forwarded).toHaveLength(0);
    expect(results[0]?.error).toBeUndefined();
    owner.dispose();
    await vi.waitFor(() => expect(dedicatedWorkers[0]?.terminated).toBe(true));
  });

  it('keeps API forwarding at zero when standby retirement transport fails', async () => {
    const owner = createWorkerCacheHost({ scope: 'integration-scope' });
    await owner.readQuery({ query: 'query OwnerWarm { ownerWarm }' });
    const gate = deferred();
    enqueueGates.set('HoldRetirementFailure', gate.promise);
    localStorage.setItem('graphql-cache:scope', 'integration-scope');
    const initializationErrors: string[] = [];
    const standby = createWorkerCacheHost({
      scope: 'integration-scope',
      onInitializationError: (error) =>
        initializationErrors.push(error.message),
    });
    const { forwarded, results } = exchangeHarness(
      standby,
      optimisticMutation(103, RETIREMENT_FAILURE_MUTATION)
    );
    await vi.waitFor(() =>
      expect(
        logs.filter(
          ({ kind, query }) =>
            kind === 'enqueue-optimistic-mutation' &&
            query?.includes('HoldRetirementFailure')
        )
      ).toHaveLength(1)
    );

    standby.dispose();
    expect(sharedWorkers[1]?.port.closed).toBe(false);
    sharedWorkers[1]?.fail('standby SharedWorker failed during retirement');
    await vi.waitFor(() => expect(results).toHaveLength(1));

    expect(forwarded).toHaveLength(0);
    expect(results[0]?.error?.networkError).toMatchObject({
      errorCode: 'admitted-enqueue-uncertain',
    });
    await vi.waitFor(() => {
      expect(localStorage.getItem('graphql-cache:scope')).toBe(
        'quarantine:integration-scope'
      );
      expect(initializationErrors).toEqual([
        'standby SharedWorker failed during retirement',
      ]);
    });
    gate.resolve();
    owner.dispose();
    await vi.waitFor(() => expect(dedicatedWorkers[0]?.terminated).toBe(true));
  });
});
