import { type Component, lazy } from 'solid-js';

/**
 * `lazy()` for a named export: the module becomes its own chunk, loaded the
 * first time the component renders or `preload()` is called.
 */
export function lazyNamed<
  K extends string,
  M extends Record<K, Component<any>>,
>(load: () => Promise<M>, name: K) {
  let pending: Promise<{ default: M[K] }> | undefined;
  const preload = () =>
    (pending ??= load().then((module) => ({ default: module[name] })));
  const component = lazy(preload);
  // Solid's preload creates an unreturned .then promise, which rejects even
  // when the caller handles the returned import. Share the loader directly.
  const solidPreload = component.preload;
  component.preload = async () => {
    const module = await preload();
    // Prime Solid's synchronous render cache only after success, when its
    // internal .then cannot create an unhandled rejection.
    await solidPreload();
    return module;
  };
  return component;
}
