import { createSignal, onCleanup } from 'solid-js';

/** Returns true to consume the back press instead of navigating. */
type SplitBackInterceptor = () => boolean;

const [interceptor, setInterceptor] = createSignal<SplitBackInterceptor | null>(
  null
);

export const splitBackInterceptor = interceptor;

/**
 * Lets the active view intercept the split header's back button (e.g. the
 * mobile composer confirming a draft before leaving). One interceptor at a
 * time; cleared when the registering owner is disposed.
 */
export function useSplitBackInterceptor(fn: SplitBackInterceptor) {
  setInterceptor(() => fn);
  onCleanup(() => setInterceptor(null));
}
