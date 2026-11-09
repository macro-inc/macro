import type { AnyStateConfig } from './types';

const mutationError = 'knownState is an internal field; use $setState';

/** A live Map with ordinary Map read semantics and unsupported public mutation. */
class KnownStateMap extends Map<AnyStateConfig, unknown> {
  set(_config: AnyStateConfig, _value: unknown): this {
    throw new Error(mutationError);
  }
  delete(_config: AnyStateConfig): boolean {
    throw new Error(mutationError);
  }
  clear(): void {
    throw new Error(mutationError);
  }
}

export function createKnownStateMap(): Map<AnyStateConfig, unknown> {
  return new KnownStateMap();
}

/** Internal bookkeeping only; typed values are written through their config. */
export function setKnownStateValue(
  map: Map<AnyStateConfig, unknown>,
  config: AnyStateConfig,
  value: unknown
): void {
  Map.prototype.set.call(map, config, value);
}
