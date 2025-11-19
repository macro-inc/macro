import { type Accessor, createSignal, type Setter } from 'solid-js';

/**
 * Generic hook for managing modal state
 * Provides state accessor, open, and close functions
 *
 * @returns Tuple of [state accessor, open function, close function]
 */
export function useModalState<T>(): [
  Accessor<T | null>,
  (data: T) => void,
  () => void,
] {
  const [state, setState] = createSignal<T | null>(null);

  const open = (data: T) => {
    // Cast setState to avoid SolidJS function updater overload
    // SolidJS treats functions as updaters, so we use a type assertion
    (setState as Setter<T | null>)(data as any);
  };

  const close = () => {
    setState(null);
  };

  return [state, open, close];
}
