import {
  type Accessor,
  createComputed,
  createMemo,
  createSignal,
  onCleanup,
  untrack,
} from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
import { useOptionalUrqlClient } from './context';
import type { ObserverClientOptions, UrqlObserverFactory } from './observer';

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
  const options = createMemo(getOptions);

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
    untrack(() => {
      const reconciled = { ...next };
      for (const key in reconciled) {
        if (Object.is(previous[key], next[key])) {
          // reconcile unwraps its entire input before comparing it. Existing
          // store proxies let unwrap skip unchanged branches in constant time.
          reconciled[key] = state[key];
        }
      }
      previous = next;
      setState(reconcile(reconciled));
    });
  };

  createComputed(() => {
    const current = observer();
    update(untrack(() => current.getCurrentResult()));
    const unsubscribe = current.subscribe(update);
    onCleanup(unsubscribe);
  });

  let firstOptionsRun = true;
  let currentClient = initialClient;

  createComputed(() => {
    const nextOptions = options();
    const nextClient = client();
    if (firstOptionsRun) {
      firstOptionsRun = false;
      return;
    }

    const current = untrack(observer);
    if (nextClient !== currentClient) {
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
