import { $PROXY } from 'solid-js';

/** Whether `value` is a Solid store proxy, whose fields change in place. */
export function isStoreProxy(value: object): boolean {
  return Reflect.get(value, $PROXY) === value;
}

/**
 * A Soup record as a mapper reads it. Soup rows are immutable values compared
 * by identity (live-view rows and urql's shared snapshots), so a mapper walks a
 * plain object and subscribes to nothing. A store proxy here would make the
 * walk track every field; development builds refuse one.
 */
export function plainSoupRecord<T extends object>(record: T): T {
  if (import.meta.env.DEV && isStoreProxy(record))
    throw new Error('A Soup mapper was handed a store proxy');
  return record;
}
