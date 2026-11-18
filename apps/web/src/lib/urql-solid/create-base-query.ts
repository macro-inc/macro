import { useFlowTrace } from '@app/observability/flow';
import {
  queryNeedsCrmProof,
  queryNeedsCrmRetirement,
} from '@graphql-cache/authority-scope';
import { Telemetry } from '@macro-inc/observability';
import { stringifyDocument } from '@urql/core';
import type { DocumentNode } from 'graphql';
import {
  type Accessor,
  batch,
  createComputed,
  createMemo,
  createSignal,
  onCleanup,
  untrack,
} from 'solid-js';
import { createStore, produce, reconcile } from 'solid-js/store';
import { crmSnapshotAuthorization } from './authorization';
import { useOptionalUrqlClient } from './context';
import type { ObserverClientOptions, UrqlObserverFactory } from './observer';
import {
  containsReactiveStore,
  supportsStoreReconciliation,
} from './reactive-selection';
import { TRACE_PARENT_CONTEXT_KEY } from './trace-parent-exchange';

/** Bridges a framework-neutral urql observer into one reactive Solid store. */
export function createBaseQuery<
  Options extends ObserverClientOptions,
  Result extends object,
>(
  getOptions: Accessor<Options>,
  createObserver: UrqlObserverFactory<Options, Result>,
  name: string,
  scopeVariables?: (options: Options) => Record<string, unknown> | undefined
): Result {
  const providerClient = useOptionalUrqlClient();
  // Requests sent while the enclosing view loads join its trace; see
  // traceParentExchange.
  const flow = useFlowTrace();
  const inputOptions = createMemo(getOptions);
  const proofScope = createMemo<{
    query?: string;
    variables?: Record<string, unknown>;
  }>(() => {
    const input = inputOptions();
    // Disabled infinite queries may have no page parameters yet. Classify
    // their current selection without evaluating unavailable variables.
    const disabled = 'enabled' in input && input.enabled === false;
    if (!('query' in input)) return {};
    return {
      query:
        typeof input.query === 'string'
          ? input.query
          : stringifyDocument(input.query as DocumentNode),
      variables: scopeVariables
        ? disabled
          ? undefined
          : scopeVariables(input)
        : 'variables' in input
          ? (input.variables as Record<string, unknown>)
          : undefined,
    };
  });
  const needsCrmProof = createMemo(() => {
    // Ownership/cursor witnesses can expire even when query options stay the same.
    crmSnapshotAuthorization().epoch;
    const scope = proofScope();
    return !scope.query || queryNeedsCrmProof(scope.query, scope.variables);
  });
  const retirementScope = createMemo(() => {
    const scope = proofScope();
    return (
      !scope.query || queryNeedsCrmRetirement(scope.query, scope.variables)
    );
  });
  const options = createMemo(() => {
    const input = inputOptions();
    const pauseForCrm =
      needsCrmProof() &&
      crmSnapshotAuthorization().paused &&
      !('enabled' in input && input.enabled === false);
    const next = {
      ...input,
      ...(pauseForCrm ? { enabled: false } : {}),
    };
    if (!flow) return next;
    return {
      ...next,
      context: { ...next.context, [TRACE_PARENT_CONTEXT_KEY]: flow },
    };
  });

  const client = createMemo(() => {
    const override = options().client;
    if (override) return override;
    if (providerClient) return providerClient();
    throw new Error(
      `${name} requires an UrqlProvider or a client option override`
    );
  });

  const initialOptions = untrack(options);
  const initialClient = untrack(client);

  const initialObserver = untrack(() =>
    createObserver(initialClient, initialOptions)
  );

  const [observer, setObserver] = createSignal(initialObserver, {
    equals: false,
  });

  let previous = untrack(() => initialObserver.getCurrentResult());
  // The store mutates its root; observer snapshots must remain independent.
  const [state, setState] = createStore<Result>({ ...previous });

  const result = new Proxy(state, {
    get(target, property) {
      return Reflect.get(target, property);
    },
  }) as Result;

  initialObserver.setReference?.(result);

  const update = (next: Result): void => {
    // Effects must see the new data and loading flags in the same update.
    batch(() =>
      untrack(() => {
        const reconciled = { ...next };
        for (const key in reconciled) {
          if (Object.is(previous[key], next[key])) {
            // reconcile unwraps its entire input before comparing it. Existing
            // store proxies let unwrap skip unchanged branches in constant time.
            reconciled[key] = state[key];
          } else if (
            key !== 'data' ||
            containsReactiveStore(next[key]) ||
            containsReactiveStore(previous[key]) ||
            !supportsStoreReconciliation(next[key]) ||
            !supportsStoreReconciliation(previous[key])
          ) {
            // Operations contain shared GraphQL documents and cached request
            // identities. Reconcile only result data; mutating metadata can
            // change an operation's name without changing its cached query text.
            setState(
              produce((draft) => {
                draft[key] = next[key];
              })
            );
            reconciled[key] = state[key];
          }
        }
        previous = next;
        const span = Telemetry.span('urql.reconcile', { sampling: 'perf' });
        try {
          setState(reconcile(reconciled));
        } finally {
          span.end();
        }
      })
    );
  };

  createComputed(() => {
    const current = observer();
    update(untrack(() => current.getCurrentResult()));
    const unsubscribe = current.subscribe(update);
    onCleanup(unsubscribe);
  });

  let firstOptionsRun = true;
  let currentClient = initialClient;
  // Disabled queries and refetches can retain an earlier result after their
  // configured scope changes. Keep its retirement requirement until disposal.
  let retainedCrmScope = untrack(retirementScope);
  let currentEpoch = untrack(crmSnapshotAuthorization).epoch;

  createComputed(() => {
    const nextOptions = options();
    const nextClient = client();
    retainedCrmScope ||= retirementScope();
    const nextEpoch = retainedCrmScope
      ? crmSnapshotAuthorization().epoch
      : currentEpoch;
    if (firstOptionsRun) {
      firstOptionsRun = false;
      return;
    }

    const current = untrack(observer);
    if (nextClient !== currentClient || nextEpoch !== currentEpoch) {
      currentEpoch = nextEpoch;
      retainedCrmScope = retirementScope();
      const replacement = untrack(() =>
        createObserver(nextClient, nextOptions)
      );
      replacement.setReference?.(result);
      currentClient = nextClient;
      setObserver(replacement);
      current.destroy();
    } else {
      currentEpoch = nextEpoch;
      untrack(() => current.setOptions(nextOptions, nextClient));
    }
  });

  onCleanup(() => {
    untrack(observer).destroy();
  });

  return result;
}
