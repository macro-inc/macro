import type { HostUpdateMetadata } from '../../../lexical-conformance/diff/host-packet.generated';

/** Validate the generated development packet without coercion or fallbacks. */
export function isHostUpdateMetadata(
  value: unknown
): value is HostUpdateMetadata {
  return (
    value !== null &&
    typeof value === 'object' &&
    'dirty_type' in value &&
    typeof value.dirty_type === 'number' &&
    Number.isInteger(value.dirty_type) &&
    value.dirty_type >= 0 &&
    value.dirty_type <= 2 &&
    'dirty_leaves' in value &&
    Array.isArray(value.dirty_leaves) &&
    value.dirty_leaves.every((key: unknown) => typeof key === 'string') &&
    'dirty_elements' in value &&
    Array.isArray(value.dirty_elements) &&
    value.dirty_elements.every(
      (entry: unknown) =>
        Array.isArray(entry) &&
        entry.length === 2 &&
        typeof entry[0] === 'string' &&
        typeof entry[1] === 'boolean'
    )
  );
}
