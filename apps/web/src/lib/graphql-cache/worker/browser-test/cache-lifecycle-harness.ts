import type { CacheHost } from '../../host/types';
import { createWorkerCacheHost } from '../../host/worker-host';
import { clearRegisteredCaches, registerCacheHost } from '../../lifecycle';

const result = document.querySelector<HTMLElement>('#result');
if (!result) throw new Error('missing Cache result node');

const parameters = new URLSearchParams(location.search);
const treatment = parameters.get('treatment') === 'true';
const scope =
  parameters.get('scope') ?? `cache-lifecycle-${crypto.randomUUID()}`;
const NativeWorker = globalThis.Worker;
const NativeSharedWorker = globalThis.SharedWorker;
const engineWorkers: Worker[] = [];
const constructedWorkerUrls: string[] = [];
globalThis.Worker = new Proxy(NativeWorker, {
  construct(target, args: ConstructorParameters<typeof Worker>) {
    const worker = Reflect.construct(target, args) as Worker;
    if (args[1]?.name?.startsWith('graphql-cache-engine:')) {
      engineWorkers.push(worker);
      constructedWorkerUrls.push(String(args[0]));
    }
    return worker;
  },
});
globalThis.SharedWorker = new Proxy(NativeSharedWorker, {
  construct(target, args: ConstructorParameters<typeof SharedWorker>) {
    constructedWorkerUrls.push(String(args[0]));
    return Reflect.construct(target, args) as SharedWorker;
  },
});
let owner: CacheHost | undefined;
let standby: CacheHost | undefined;
let unregisterOwner: (() => void) | undefined;
let hostConstructionCount = 0;

const query = (
  operationName: string
) => `query ${operationName}($input: SoupInput!) {
  user {
    id
    soup(input: $input) {
      nextCursor
      items { __typename id }
    }
  }
}`;
const variables = (limit: number) => ({ input: { limit } });
const data = (identity: string, value: string) => ({
  user: {
    id: identity,
    soup: {
      nextCursor: null,
      items: [{ __typename: 'GraphqlSoupDocument', id: value }],
    },
  },
});

function requireOwner(): CacheHost {
  if (!owner) throw new Error('Cache cache host is not started');
  return owner;
}

async function read(host: CacheHost, limit: number, name: string) {
  return await host.readQuery({
    query: query(name),
    operationName: name,
    variables: variables(limit),
  });
}

async function startOwner(registerForLogout = false): Promise<void> {
  if (!treatment) {
    throw new Error('Cache control/default-off cannot activate cache');
  }
  if (owner) return;
  hostConstructionCount += 1;
  owner = createWorkerCacheHost({
    scope,
    requestTimeoutMs: 20_000,
    initializationTimeoutMs: 20_000,
    rolloutCohort: 'treatment',
  });
  if (registerForLogout) unregisterOwner = registerCacheHost(owner);
  await read(owner, 1, 'CacheLifecycleQuery');
}

const api = {
  scope,
  rolloutMode(): 'control' | 'treatment' {
    return treatment ? 'treatment' : 'control';
  },
  hostConstructionCount(): number {
    return hostConstructionCount;
  },
  constructedWorkerUrls(): string[] {
    return [...constructedWorkerUrls];
  },
  engineWorkerCount(): number {
    return engineWorkers.length;
  },
  navigationDurationMs(): number {
    return (
      (
        performance.getEntriesByType('navigation')[0] as
          | PerformanceNavigationTiming
          | undefined
      )?.duration ?? 0
    );
  },
  async start(): Promise<void> {
    await startOwner();
    if (standby) return;
    hostConstructionCount += 1;
    standby = createWorkerCacheHost({
      scope,
      requestTimeoutMs: 20_000,
      initializationTimeoutMs: 20_000,
      rolloutCohort: 'treatment',
    });
    await read(standby, 1, 'CacheLifecycleQuery');
  },
  async startSingle(): Promise<void> {
    await startOwner();
  },
  async startLogoutHost(): Promise<void> {
    await startOwner(true);
  },
  async write(
    value: string,
    identity = 'cache-lifecycle-user',
    limit = 1
  ): Promise<void> {
    const host = requireOwner();
    await host.writeQuery({
      query: query('CacheLifecycleQuery'),
      operationName: 'CacheLifecycleQuery',
      variables: variables(limit),
      data: data(identity, value),
      identity,
    });
  },
  async read(limit = 1): Promise<unknown> {
    return await read(requireOwner(), limit, 'CacheLifecycleQuery');
  },
  async logoutReset(limit = 1): Promise<unknown> {
    if (!unregisterOwner) {
      throw new Error('Cache logout host is not registered');
    }
    await clearRegisteredCaches();
    return await read(requireOwner(), limit, 'CacheLifecycleQuery');
  },
  async closeSamePageStandbyHost(): Promise<{
    ownerRead: unknown;
    engineWorkerCount: number;
  }> {
    if (!standby) throw new Error('Cache standby is not started');
    standby.dispose();
    standby = undefined;
    return {
      ownerRead: await read(requireOwner(), 1, 'CacheLifecycleQuery'),
      engineWorkerCount: engineWorkers.length,
    };
  },
  async startStandby(): Promise<void> {
    if (!treatment) throw new Error('Cache control cannot start standby');
    if (standby) return;
    hostConstructionCount += 1;
    standby = createWorkerCacheHost({
      scope,
      requestTimeoutMs: 20_000,
      initializationTimeoutMs: 20_000,
      rolloutCohort: 'treatment',
    });
    await read(standby, 1, 'CacheLifecycleQuery');
  },
  async cleanOwnerHandoff(): Promise<unknown> {
    if (!standby) throw new Error('Cache standby is not started');
    const retiring = requireOwner();
    const replacement = standby;
    standby = undefined;
    retiring.dispose();
    owner = replacement;
    return await read(replacement, 1, 'CacheLifecycleQuery');
  },
  async identityReset(): Promise<{ old: unknown; current: unknown }> {
    const host = requireOwner();
    await host.writeQuery({
      query: query('CacheLifecycleQuery'),
      operationName: 'CacheLifecycleQuery',
      variables: variables(1),
      data: data('cache-lifecycle-user-a', 'identity-a'),
      identity: 'cache-lifecycle-user-a',
    });
    await host.writeQuery({
      query: query('CacheLifecycleQuery'),
      operationName: 'CacheLifecycleQuery',
      variables: variables(2),
      data: data('cache-lifecycle-user-b', 'identity-b'),
      identity: 'cache-lifecycle-user-b',
    });
    return {
      old: await read(host, 1, 'CacheLifecycleQuery'),
      current: await read(host, 2, 'CacheLifecycleQuery'),
    };
  },
  async abruptOwnerLoss(): Promise<{
    oldRequestRejected: boolean;
    replacement: unknown;
  }> {
    const host = requireOwner();
    await api.write('abrupt-must-wipe', 'cache-lifecycle-user-b', 3);
    const currentWorker = engineWorkers.at(-1);
    if (!currentWorker) throw new Error('missing elected Cache engine worker');
    currentWorker.terminate();
    const oldRequestRejected = await read(host, 3, 'CacheLifecycleQuery').then(
      () => false,
      () => true
    );
    const deadline = performance.now() + 20_000;
    for (;;) {
      try {
        const replacement = await read(host, 3, 'CacheLifecycleQuery');
        return { oldRequestRejected, replacement };
      } catch (error) {
        if (performance.now() >= deadline) throw error;
        await new Promise<void>((resolve) => setTimeout(resolve, 50));
      }
    }
  },
  dispose(): void {
    unregisterOwner?.();
    unregisterOwner = undefined;
    owner?.dispose();
    standby?.dispose();
    owner = undefined;
    standby = undefined;
  },
};

declare global {
  interface Window {
    cacheLifecycleHarness: typeof api;
  }
}

window.cacheLifecycleHarness = api;
result.dataset.status = 'ready';
result.dataset.rollout = treatment ? 'treatment' : 'control';
result.textContent = JSON.stringify({
  scopeFreeTelemetry: true,
  rollout: result.dataset.rollout,
});
