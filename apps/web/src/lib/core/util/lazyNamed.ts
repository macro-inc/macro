import { type Component, lazy } from 'solid-js';

/**
 * `lazy()` for a named export: the module becomes its own chunk, loaded the
 * first time the component renders or `preload()` is called.
 */
export function lazyNamed<
  K extends string,
  M extends Record<K, Component<any>>,
>(load: () => Promise<M>, name: K) {
  return lazy(async () => ({ default: (await load())[name] }));
}
