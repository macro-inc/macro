import { lazy } from '@core/util/lazy';
import type { JSX } from 'solid-js';

/**
 * `lazy()` for a named export: the module becomes its own chunk, loaded the
 * first time the component renders or `preload()` is called.
 */
export function lazyNamed<
  K extends string,
  M extends Record<K, (...props: never[]) => JSX.Element>,
>(load: () => Promise<M>, name: K) {
  return lazy<Parameters<M[K]>>(async () => ({
    default: (await load())[name],
  }));
}
