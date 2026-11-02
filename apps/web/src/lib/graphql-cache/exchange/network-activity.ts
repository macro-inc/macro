import type { Exchange } from '@urql/core';
import { onEnd, pipe, tap } from 'wonka';

let requests = 0;
const listeners = new Set<() => void>();

export const graphqlNetworkBusy = () => requests > 0;
export function subscribeGraphqlNetworkActivity(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Count network-bound operations only; cache hits and live subscriptions are idle. */
export const networkActivityExchange: Exchange = ({ forward }) => {
  const pending = new Set<number>();
  const changed = () => {
    for (const listener of listeners) listener();
  };
  const finish = (key: number) => {
    if (!pending.delete(key)) return;
    requests--;
    changed();
  };
  return (operations) =>
    pipe(
      operations,
      tap((operation) => {
        if (operation.kind === 'teardown') finish(operation.key);
        else if (
          operation.kind !== 'subscription' &&
          !pending.has(operation.key)
        ) {
          pending.add(operation.key);
          requests++;
          changed();
        }
      }),
      forward,
      tap((result) => {
        if (!result.hasNext) finish(result.operation.key);
      }),
      onEnd(() => {
        for (const key of pending) finish(key);
      })
    );
};
