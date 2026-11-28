/**
 * Counts what Solid allocates while a harness runs, through the development
 * build's hooks (`DEV.hooks`, present because the test config resolves
 * `solid-js` with the `development` condition):
 *
 * - `owners`: computations, memos, effects and roots created.
 * - `signals`: `createSignal` calls (Solid's own internal signals excluded).
 * - `storeNodes`: per-property signals store proxies created for tracked
 *   reads, the cost FE-70 is about. Solid creates them as internal signals,
 *   so they are counted from the node maps it attaches to store targets.
 */
import { DEV } from 'solid-js';

export type SolidAllocations = {
  owners: number;
  signals: number;
  storeNodes: number;
};

export type SolidAllocationCounter = {
  read(): SolidAllocations;
  /** Allocations since `mark`. */
  since(mark: SolidAllocations): SolidAllocations;
  dispose(): void;
};

const STORE_NODE_SYMBOLS = new Set(['store-node', 'store-has']);

/** Installs the hooks; one counter at a time. */
export function countSolidAllocations(): SolidAllocationCounter {
  const hooks = DEV?.hooks;
  if (!hooks)
    throw new Error(
      'solid-js resolved to its production build; Solid allocations need the development build'
    );
  let owners = 0;
  let signals = 0;
  // Store targets whose node maps were created while counting. A map only
  // grows (Solid deletes a node only when its property is deleted), so the
  // nodes allocated are the sum of their sizes.
  const nodeMaps: object[] = [];
  const previousOwner = hooks.afterCreateOwner;
  const previousSignal = hooks.afterCreateSignal;
  hooks.afterCreateOwner = (owner) => {
    owners += 1;
    previousOwner?.(owner);
  };
  hooks.afterCreateSignal = (signal) => {
    signals += 1;
    previousSignal?.(signal);
  };
  const defineProperty = Object.defineProperty;
  Object.defineProperty = function <T>(
    target: T,
    key: PropertyKey,
    attributes: PropertyDescriptor & ThisType<unknown>
  ): T {
    if (
      typeof key === 'symbol' &&
      key.description !== undefined &&
      STORE_NODE_SYMBOLS.has(key.description) &&
      typeof attributes.value === 'object' &&
      attributes.value !== null
    )
      nodeMaps.push(attributes.value as object);
    return defineProperty(target, key, attributes);
  } as typeof Object.defineProperty;
  const read = (): SolidAllocations => {
    let storeNodes = 0;
    // `Reflect.ownKeys`: the node a key iteration tracks is keyed by a
    // symbol (`store-self`), which `Object.keys` skips.
    for (const nodes of nodeMaps) storeNodes += Reflect.ownKeys(nodes).length;
    return { owners, signals, storeNodes };
  };
  return {
    read,
    since: (mark) => {
      const now = read();
      return {
        owners: now.owners - mark.owners,
        signals: now.signals - mark.signals,
        storeNodes: now.storeNodes - mark.storeNodes,
      };
    },
    dispose: () => {
      hooks.afterCreateOwner = previousOwner;
      hooks.afterCreateSignal = previousSignal;
      Object.defineProperty = defineProperty;
    },
  };
}
