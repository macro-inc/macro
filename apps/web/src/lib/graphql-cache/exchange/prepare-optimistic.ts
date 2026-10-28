import {
  CombinedError,
  type Exchange,
  type Operation,
  type OperationResult,
} from '@urql/core';
import { filter, map, merge, pipe, share } from 'wonka';

/** A bad local recipe fails only its mutation, before any network side effect. */
export function prepareOptimisticExchange(
  prepare: (operation: Operation) => Operation
): Exchange {
  return ({ forward }) =>
    (operations) => {
      const prepared = pipe(
        operations,
        map((operation): Operation | OperationResult => {
          try {
            return prepare(operation);
          } catch (error) {
            return {
              operation,
              error: new CombinedError({
                graphQLErrors: [
                  error instanceof Error ? error : new Error(String(error)),
                ],
              }),
              stale: false,
              hasNext: false,
            };
          }
        }),
        share
      );
      return merge([
        pipe(
          prepared,
          filter((item): item is OperationResult => 'operation' in item)
        ),
        forward(
          pipe(
            prepared,
            filter((item): item is Operation => !('operation' in item))
          )
        ),
      ]);
    };
}
