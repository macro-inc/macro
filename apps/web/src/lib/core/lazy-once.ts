import { type Component, createComponent, lazy } from 'solid-js';

export type LazyOnceComponent<P extends Record<string, unknown>> =
  Component<P> & {
    /** Fetch the module now, so a later mount does not have to wait for it. */
    preload: () => void;
  };

/**
 * `lazy`, except that only the first mount ever waits for the module.
 *
 * Solid's `lazy` forgets the component it loaded when its instance is disposed,
 * so mounting the same one again builds a fresh resource around the settled
 * import and suspends on it before reading it back. Holding the resolved
 * component here keeps every mount after the first synchronous, which matters
 * for a view that remounts while the user is looking at it: the old tree is
 * replaced by the new one in one update, with no `<Suspense>` fallback in
 * between.
 *
 * `preload` makes the *first* mount synchronous too, for a view whose fallback
 * is a full-screen loading state that the user should never meet.
 */
export function lazyOnce<P extends Record<string, unknown>>(
  load: () => Promise<{ default: Component<P> }>
): LazyOnceComponent<P> {
  let loaded: Component<P> | undefined;
  let started: Promise<{ default: Component<P> }> | undefined;
  const start = () =>
    (started ??= (async () => {
      const module = await load();
      loaded = module.default;
      return module;
    })());
  const loading = lazy(start);
  const component = ((props) =>
    createComponent(loaded ?? loading, props)) as LazyOnceComponent<P>;
  component.preload = () => void start();
  return component;
}

/**
 * Fetch these components once the browser has nothing better to do.
 *
 * For a primary destination this is the difference between the chunk arriving
 * while the user reads the page they are already on and arriving while they
 * stare at a loading screen. Browsers without `requestIdleCallback` keep
 * loading on demand rather than competing with startup work.
 */
export function preloadWhenIdle(
  ...components: { preload: () => void }[]
): void {
  if (typeof window === 'undefined') return;
  if (typeof window.requestIdleCallback !== 'function') return;
  window.requestIdleCallback(
    () => {
      for (const component of components) component.preload();
    },
    { timeout: 10_000 }
  );
}
