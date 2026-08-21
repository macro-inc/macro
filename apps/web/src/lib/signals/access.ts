import type { Accessor } from 'solid-js';

/** A fixed value or a reactive accessor that returns it. */
export type MaybeAccessor<T> = T | Accessor<T>;

/** Reads a fixed value or invokes its reactive accessor. */
export function access<T>(value: MaybeAccessor<T>): T {
  return typeof value === 'function' ? (value as Accessor<T>)() : value;
}
