/**
 * Minimal Solid binding over a urql query: signals that track the latest
 * operation result for as long as the owner scope lives.
 *
 * Unlike an imperative `.toPromise()` call, the underlying source stays
 * subscribed, so results *pushed* by the normalized cache exchange
 * (optimistic mutations, sibling writes, other tabs) re-render consumers
 * immediately — this is the primitive that lets UI flow through urql
 * instead of TanStack invalidation.
 *
 * Deliberately kept out of `@graphql-cache/index`: it depends on solid-js,
 * which the transport-level consumers of that barrel must not pull in.
 */

import type { TypedDocumentNode } from '@graphql-typed-document-node/core';
import type {
  AnyVariables,
  Client,
  CombinedError,
  RequestPolicy,
} from '@urql/core';
import {
  type Accessor,
  batch,
  createRenderEffect,
  createSignal,
  onCleanup,
  untrack,
} from 'solid-js';
import { pipe, subscribe } from 'wonka';

export type QuerySignal<TData> = {
  /** Latest result data; retains the previous value across re-executions. */
  data: Accessor<TData | undefined>;
  error: Accessor<CombinedError | undefined>;
  /** True from (re)subscription until the first result arrives. */
  fetching: Accessor<boolean>;
  /** True while the emitted result is a stale cache hit being revalidated. */
  stale: Accessor<boolean>;
};

export type CreateQuerySignalOptions<TData, TVariables extends AnyVariables> = {
  client: Accessor<Client>;
  document: TypedDocumentNode<TData, TVariables>;
  /**
   * Reactive variables; `undefined` pauses the query (unsubscribes and
   * reports `fetching: false` while keeping the last data).
   */
  variables: Accessor<TVariables | undefined>;
  requestPolicy?: RequestPolicy;
};

export function createQuerySignal<TData, TVariables extends AnyVariables>(
  options: CreateQuerySignalOptions<TData, TVariables>
): QuerySignal<TData> {
  const [data, setData] = createSignal<TData | undefined>(undefined);
  const [error, setError] = createSignal<CombinedError | undefined>(undefined);
  const [fetching, setFetching] = createSignal(false);
  const [stale, setStale] = createSignal(false);

  // Render effect: subscribes synchronously so consumers created in the
  // same reactive scope observe `fetching` immediately.
  createRenderEffect(() => {
    const variables = options.variables();
    if (variables === undefined) {
      setFetching(false);
      return;
    }
    const client = options.client();
    setFetching(true);
    const subscription = untrack(() =>
      pipe(
        client.query(options.document, variables, {
          requestPolicy: options.requestPolicy,
        }),
        subscribe((result) => {
          batch(() => {
            setData(() => result.data);
            setError(result.error);
            setStale(result.stale);
            setFetching(false);
          });
        })
      )
    );
    onCleanup(subscription.unsubscribe);
  });

  return { data, error, fetching, stale };
}
