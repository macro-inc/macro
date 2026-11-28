import { networkRevalidationExchange } from '@graphql-cache/exchange/network-revalidation-exchange';
import {
  createClient,
  type DocumentInput,
  type Operation,
  type OperationResult,
} from '@urql/core';
import { empty, fromPromise, mergeMap, pipe } from 'wonka';

/** A Soup client without a working normalized cache, as the app builds it:
 * `networkRevalidationExchange` over a server that answers every request.
 * Mutations get `mutationData`; queries get `{}` and are counted per name. */
export function createRevalidatingClient(
  mutationData: (operation: Operation) => unknown
) {
  const requests: Operation[] = [];
  const client = createClient({
    url: 'http://test/graphql',
    exchanges: [
      networkRevalidationExchange(),
      () => (operations$) =>
        pipe(
          operations$,
          mergeMap((operation) => {
            if (operation.kind === 'teardown') return empty;
            requests.push(operation);
            const result: OperationResult = {
              operation,
              data:
                operation.kind === 'mutation' ? mutationData(operation) : {},
              stale: false,
              hasNext: false,
            };
            return fromPromise(Promise.resolve(result));
          })
        ),
    ],
  });
  /** Mount a query the way a list observer does, until the test ends. */
  async function mount(document: DocumentInput, variables: object = {}) {
    let subscription!: { unsubscribe(): void };
    await new Promise<void>((resolve) => {
      subscription = client
        .query(document, variables)
        .subscribe(() => resolve());
    });
    return subscription;
  }
  const reads = (name: string) =>
    requests.filter(
      (operation) =>
        operation.kind === 'query' &&
        operation.query.definitions.some(
          (definition) =>
            definition.kind === 'OperationDefinition' &&
            definition.name?.value === name
        )
    ).length;
  return { client, requests, mount, reads };
}
