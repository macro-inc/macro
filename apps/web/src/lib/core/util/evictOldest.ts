/**
 * Evicts entries in insertion order until `collection` holds at most
 * `maxSize`. Set and Map iterate in insertion order, so this turns a plain
 * collection into a drop-oldest bounded cache.
 */
export function evictOldest<K>(
  collection: Set<K> | Map<K, unknown>,
  maxSize: number
) {
  while (collection.size > maxSize) {
    const oldest = collection.keys().next().value;
    if (oldest === undefined) break;
    collection.delete(oldest);
  }
}
