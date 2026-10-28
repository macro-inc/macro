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

/**
 * Resolves one committed Back press — the split header's button or Android's
 * system Back — so both route through the active view's interceptor instead of
 * navigating straight away. Returns false when nothing consumed the press,
 * which leaves Android's Back to the system.
 */
export function runSplitBack(navigation: {
  canGoBack: () => boolean;
  goBack: () => void;
}): boolean {
  if (!navigation.canGoBack()) return false;
  if (interceptor()?.()) return true;
  navigation.goBack();
  return true;
}
