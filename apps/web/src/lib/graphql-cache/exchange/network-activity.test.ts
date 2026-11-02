import {
  createClient,
  gql,
  type Operation,
  type OperationResult,
} from '@urql/core';
import { expect, it, vi } from 'vitest';
import { empty, makeSubject, mergeMap, pipe, type Subject } from 'wonka';
import {
  graphqlNetworkBusy,
  networkActivityExchange,
  subscribeGraphqlNetworkActivity,
} from './network-activity';

it('counts overlapping network operations through results, cancellation and subscriptions', () => {
  const requests: {
    operation: Operation;
    response: Subject<OperationResult>;
  }[] = [];
  const client = createClient({
    url: 'http://test/graphql',
    exchanges: [
      networkActivityExchange,
      () => (operations) =>
        pipe(
          operations,
          mergeMap((operation) => {
            if (operation.kind === 'teardown') return empty;
            const response = makeSubject<OperationResult>();
            requests.push({ operation, response });
            return response.source;
          })
        ),
    ],
  });
  const changed = vi.fn();
  const unsubscribe = subscribeGraphqlNetworkActivity(changed);
  const query = client
    .query(gql`query First { first }`, {})
    .subscribe(() => {});
  const other = client
    .query(gql`query Second { second }`, {})
    .subscribe(() => {});
  expect(graphqlNetworkBusy()).toBe(true);
  const { operation, response } = requests[0];
  response.next({ operation, data: {}, stale: false, hasNext: true });
  expect(graphqlNetworkBusy()).toBe(true);
  response.next({ operation, data: {}, stale: false, hasNext: false });
  expect(graphqlNetworkBusy()).toBe(true);
  other.unsubscribe();
  expect(graphqlNetworkBusy()).toBe(false);
  query.unsubscribe();
  const subscription = client
    .subscription(gql`subscription Live { events }`, {})
    .subscribe(() => {});
  expect(graphqlNetworkBusy()).toBe(false);
  subscription.unsubscribe();
  expect(changed).toHaveBeenCalledTimes(4);
  unsubscribe();
});
