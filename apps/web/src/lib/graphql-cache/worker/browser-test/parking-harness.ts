import {
  createClient,
  fetchExchange,
  gql,
  stringifyDocument,
} from '@urql/core';
import { normalizedCacheExchange } from '../../exchange/normalized-cache-exchange';
import type { CacheHost } from '../../host/types';
import { createWorkerCacheHost } from '../../host/worker-host';

const params = new URLSearchParams(location.search);
const scope = params.get('scope');
if (!scope?.startsWith('cache-parking-'))
  throw new Error('synthetic scope required');
const nativeWorker = globalThis.Worker;
const parked = Promise.withResolvers<void>();
const epochs: number[] = [];
globalThis.Worker = new Proxy(nativeWorker, {
  construct(_target, args: ConstructorParameters<typeof Worker>) {
    const worker = new nativeWorker(...args);
    if (args[1]?.name?.startsWith('graphql-cache-engine:')) {
      epochs.push(Number(args[1].name.split(':').at(-1)));
      const terminate = worker.terminate.bind(worker);
      worker.terminate = () => {
        terminate();
        parked.resolve();
      };
    }
    return worker;
  },
});
const query = 'query ParkingWitness { user { id } }';
const data = { user: { id: 'macro|parking-fixture' } };
const mutation = gql`mutation ParkingMutation($input: SetEntityPropertyInput!) {
  setEntityProperty(input: $input) { id displayName }
}`;
const variables = (uuid: string) => ({
  input: {
    entityType: 'DOCUMENT',
    entityId: 'synthetic-document',
    propertyDefinitionId: uuid,
    value: { string: 'synthetic' },
  },
});
let host: CacheHost | undefined;
let apiRequests = 0;
let generationBefore: string | undefined;
let seedUuid: string | undefined;
const response = Promise.withResolvers<Response>();
const sent = Promise.withResolvers<void>();
const settling = Promise.withResolvers<void>();
let result: Promise<unknown> | undefined;
function requireHost(): CacheHost {
  if (!host) throw new Error('cache not started');
  return host;
}
const api = {
  async start(seed = false) {
    host ??= createWorkerCacheHost({ scope });
    if (seed) {
      await host.writeQuery({ query, data });
      seedUuid = crypto.randomUUID();
      const now = Date.now();
      await host.enqueueOptimisticMutation(
        {
          uuid: seedUuid,
          query: stringifyDocument(mutation),
          variables: variables(seedUuid),
          data: { setEntityProperty: { id: seedUuid, displayName: 'Queued' } },
        },
        {
          owner: 'parking-seed',
          nowMs: now,
          leaseExpiresAtMs: now + 86_400_000,
        }
      );
    }
    generationBefore ??= await host.currentStorageGeneration();
    return generationBefore;
  },
  async snapshot() {
    const current = requireHost();
    return {
      clientId: current.clientId,
      generation: await current.currentStorageGeneration(),
      queue: await current.inspectMutations?.(),
      read: await current.readQuery({ query }),
      generationBefore,
      seedUuid,
      epochs: [...epochs],
      apiRequests,
      visibility: document.visibilityState,
    };
  },
  parked: () => parked.promise,
  async locks() {
    return (await navigator.locks.query()).held?.filter((lock) =>
      lock.name?.includes(scope)
    );
  },
  async beginMutation() {
    const current = requireHost();
    await current.writeQuery({ query, data });
    generationBefore = await current.currentStorageGeneration();
    const uuid = crypto.randomUUID();
    const client = createClient({
      url: 'https://parking.invalid/graphql',
      fetch: async () => {
        apiRequests += 1;
        sent.resolve();
        return await response.promise;
      },
      exchanges: [
        normalizedCacheExchange({
          ...current,
          async commitOptimisticWrite(...args) {
            const committed = current.commitOptimisticWrite(...args);
            settling.resolve();
            return await committed;
          },
        }),
        fetchExchange,
      ],
    });
    result = client
      .mutation(mutation, variables(uuid), {
        normalizedCacheOptimistic: {
          uuid,
          optimisticResponse: {
            setEntityProperty: { id: uuid, displayName: 'Optimistic' },
          },
        },
      })
      .toPromise();
    await sent.promise;
    return uuid;
  },
  async reply(uuid: string) {
    response.resolve(
      new Response(
        JSON.stringify({
          data: {
            setEntityProperty: { id: uuid, displayName: 'Confirmed' },
          },
        }),
        { headers: { 'content-type': 'application/json' } }
      )
    );
    await settling.promise;
  },
  result: () => result,
  async competingClaim() {
    return await requireHost().claimNextMutation(
      'parking-competitor',
      Date.now() + 600_000,
      Date.now() + 900_000
    );
  },
  dispose() {
    host?.dispose();
  },
};
declare global {
  interface Window {
    cacheParkingHarness: typeof api;
  }
}
window.cacheParkingHarness = api;
document.querySelector('#result')?.setAttribute('data-status', 'ready');
