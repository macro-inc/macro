import { createBlockSignal } from '@core/block';
import type { Accessor } from 'solid-js';

/**
 * Utility for creating some block-shared set of utilities that for
 * performance or data-safety reasons should be enforced as a singleton
 * across a block. This is useful for building grouped, derived methods and
 * state on top of block resources.
 */
export function sharedInstance<T>(factory: () => T): Accessor<T> {
  let instance = createBlockSignal<T>();
  return () => {
    const [i, setI] = instance;
    if (i() === undefined) {
      setI(() => factory());
    }
    return i()!;
  };
}
