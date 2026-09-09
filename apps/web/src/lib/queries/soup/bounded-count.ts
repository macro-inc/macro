/** Only complete results can establish a total below the badge's display cap. */
export function boundedCount(
  keys: Iterable<string>,
  complete: boolean
): number | '99+' | undefined {
  const count = new Set(keys).size;
  if (count >= 100) return '99+';
  return complete ? count : undefined;
}
