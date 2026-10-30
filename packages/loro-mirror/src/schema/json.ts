/** Reject unsupported values before a batch can write any CRDT operations. */
export function isJsonValue(
  value: unknown,
  ancestors = new Set<object>()
): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object' || ancestors.has(value)) return false;
  if (
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) !== Object.prototype &&
    Object.getPrototypeOf(value) !== null
  )
    return false;
  ancestors.add(value);
  const valid = Object.values(value).every((child) =>
    isJsonValue(child, ancestors)
  );
  ancestors.delete(value);
  return valid;
}
