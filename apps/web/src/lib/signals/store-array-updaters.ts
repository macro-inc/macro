export type ArrayStoreUpdater<T> = (values: T[] | undefined) => T[];

export type Equality<T> = (left: T, right: T) => boolean;

/**
 * Creates an updater that appends a value only when it is not already present.
 * Pass it directly to a Solid signal setter or store path setter.
 *
 * @example
 * setState('items', addUnique(item));
 */
export function addUnique<T>(
  value: T,
  equals: Equality<T> = Object.is
): ArrayStoreUpdater<T> {
  return (values) => {
    const current = values ?? [];
    return current.some((item) => equals(item, value))
      ? current
      : [...current, value];
  };
}

/**
 * Creates an updater that removes matching values while preserving the current
 * array reference when there is nothing to remove.
 *
 * @example
 * setState('items', removeValue(item));
 */
export function removeValue<T>(
  value: T,
  equals: Equality<T> = Object.is
): ArrayStoreUpdater<T> {
  return (values) => {
    const current = values ?? [];
    const next = current.filter((item) => !equals(item, value));
    return next.length === current.length ? current : next;
  };
}

/**
 * Creates an updater that removes a present value or appends a missing value.
 * An optional equality function supports values that need identity by key.
 *
 * @example
 * setState('items', toggleValue(item));
 */
export function toggleValue<T>(
  value: T,
  equals: Equality<T> = Object.is
): ArrayStoreUpdater<T> {
  return (values) => {
    const current = values ?? [];
    return current.some((item) => equals(item, value))
      ? removeValue(value, equals)(current)
      : [...current, value];
  };
}
