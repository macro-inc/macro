import type { EntityData } from '@entity';

// Kept free of runtime imports so tests can load it without the app graph.

/** A call with at least one guest, i.e. someone joined without a Macro account. */
export function externalCallFilter(entity: EntityData): boolean {
  return entity.type === 'call' && (entity.guests?.length ?? 0) > 0;
}

/** A call attended only by Macro users. */
export function internalCallFilter(entity: EntityData): boolean {
  return entity.type === 'call' && (entity.guests?.length ?? 0) === 0;
}
