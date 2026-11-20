import { useFlowTrace } from '@app/observability/flow';
import { usePaneHidden } from '@core/context/pane-visibility';
import { cacheSessionGeneration } from '@graphql-cache/session-generation';
import { Telemetry } from '@macro-inc/observability';
import {
  type Accessor,
  batch,
  createComputed,
  createMemo,
  createSignal,
  on,
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

const LATEST_RESULT = Symbol('urql-latest-result');

/**
 * The observer's latest result. In a hidden parked pane the store holds an
 * older one until the pane shows, so code that waits for its own request to
 * settle (an explicit refresh) reads this instead.
 */
export function latestResult<Result extends object>(query: Result): Result {
  const read = (query as { [LATEST_RESULT]?: Accessor<Result> })[LATEST_RESULT];
  return read ? read() : query;
}

/** Bridges a framework-neutral urql observer into one reactive Solid store. */
export function createBaseQuery<
  Options extends ObserverClientOptions,
  Result extends object,
>(
  getOptions: Accessor<Options>,
  createObserver: UrqlObserverFactory<Options, Result>,
  name: string
): Result {
  const providerClient = useOptionalUrqlClient();
  // Requests sent while the enclosing view loads join its trace; see
  // traceParentExchange.
  const flow = useFlowTrace();
  const options = createMemo(() => {
    const input = getOptions();
    const next = crmSnapshotAuthorization().paused
      ? { ...input, enabled: false }
      : input;
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

  const [latest, setLatest] = createSignal<Result>(previous);
  const result = new Proxy(state, {
    get(target, property) {
      if (property === LATEST_RESULT) return latest;
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

  // A hidden parked pane keeps only the latest result and applies it once
  // shown, so nothing it renders changes while hidden.
  const paneHidden = usePaneHidden();
  let held: Result | undefined;
  const deliver = (next: Result): void => {
    setLatest(() => next);
    if (untrack(paneHidden)) {
      held = next;
      return;
    }
    update(next);
  };
  createComputed(
    on(
      paneHidden,
      (hidden) => {
        if (hidden || !held) return;
        const next = held;
        held = undefined;
        update(next);
      },
      { defer: true }
    )
  );

  createComputed(() => {
    const current = observer();
    deliver(untrack(() => current.getCurrentResult()));
    const unsubscribe = current.subscribe(deliver);
    onCleanup(unsubscribe);
  });

  let firstOptionsRun = true;
  let currentClient = initialClient;
  let generation = untrack(crmSnapshotAuthorization).epoch;

  createComputed(() => {
    const nextOptions = options();
    const nextClient = client();
    const nextGeneration = crmSnapshotAuthorization().epoch;
    if (firstOptionsRun) {
      firstOptionsRun = false;
      return;
    }

    const current = untrack(observer);
    if (
      nextClient !== currentClient ||
      !cacheSessionGeneration.isCurrent(generation)
    ) {
      generation = nextGeneration;
      const replacement = untrack(() =>
        createObserver(nextClient, nextOptions)
      );
      replacement.setReference?.(result);
      currentClient = nextClient;
      setObserver(replacement);
      current.destroy();
    } else {
      untrack(() => current.setOptions(nextOptions, nextClient));
    }
  });

  onCleanup(() => {
    untrack(observer).destroy();
  });

  return result;
}
