import {
  type Accessor,
  createEffect,
  createSignal,
  on,
  onCleanup,
} from 'solid-js';

/**
 * Accounts that just went from no work to having some, for as long as the
 * moment should be announced. Each account is announced once until its work
 * has gone away.
 */
export function createWorkArrivals(options: {
  loaded: Accessor<boolean>;
  accountsWithWork: Accessor<readonly string[]>;
  /** Also announce work that's already there when the list first loads. */
  announceInitial?: boolean;
  durationMs: number;
}) {
  const [arrivals, setArrivals] = createSignal<readonly string[]>([]);
  let known = new Set<string>();
  let baselineTaken = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const dismiss = () => {
    clearTimeout(timer);
    setArrivals([]);
  };

  createEffect(
    on([options.loaded, options.accountsWithWork], ([loaded, accounts]) => {
      if (!loaded) {
        known = new Set();
        baselineTaken = false;
        dismiss();
        return;
      }

      const fresh = accounts.filter((id) => !known.has(id));
      const announce =
        fresh.length > 0 && (baselineTaken || options.announceInitial === true);
      known = new Set(accounts);
      baselineTaken = true;
      if (!announce) return;

      setArrivals((current) => [...new Set([...current, ...fresh])]);
      clearTimeout(timer);
      timer = setTimeout(() => setArrivals([]), options.durationMs);
    })
  );
  onCleanup(() => clearTimeout(timer));

  return { arrivals, dismiss };
}
