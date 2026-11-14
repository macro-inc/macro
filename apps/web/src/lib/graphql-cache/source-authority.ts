/** Tokens belong to the source read, never to a later write of its contents. */
const sourceGenerations = new WeakMap<object, string>();
const sourceEpochs = new WeakMap<object, number>();
export function markSourceAuthority<T>(
  value: T,
  generation: string | undefined,
  epoch?: number
): T {
  if (value && typeof value === 'object' && generation)
    sourceGenerations.set(value, generation);
  if (value && typeof value === 'object' && epoch !== undefined)
    sourceEpochs.set(value, epoch);
  return value;
}
export function sourceAuthorityEpoch(value: unknown): number | undefined {
  return value && typeof value === 'object'
    ? sourceEpochs.get(value)
    : undefined;
}
export function sourceAuthorityGeneration(value: unknown): string | undefined {
  return value && typeof value === 'object'
    ? sourceGenerations.get(value)
    : undefined;
}
