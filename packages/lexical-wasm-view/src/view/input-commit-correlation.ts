/** Pure JS numbering shared by the real module guard and every bound Port. */
const highest = new WeakMap<object, bigint>();
const MAX_CORRELATION = (1n << 64n) - 1n;

export class InputCommitCorrelationExhausted extends Error {
  constructor() {
    super('Input commit correlation exhausted');
  }
}

/** Called only after active/cleaning admission and before the actual delegate. */
export function recordGuardedInputCommitCorrelation(
  receiver: unknown,
  value: unknown
): void {
  if (typeof value !== 'string')
    throw new TypeError(
      'Observed input correlation must be a primitive string'
    );
  // Invalid IDs continue to the native validator without changing this map.
  if (value.length > 20 || !/^[1-9][0-9]*$/.test(value)) return;
  const id = BigInt(value);
  if (id > MAX_CORRELATION || typeof receiver !== 'object' || receiver === null)
    return;
  if (id > (highest.get(receiver) ?? 0n)) highest.set(receiver, id);
}

/** Mint only after factory/encode/clock/session getters; next statement calls native. */
export function mintInputCommitCorrelation(
  session: object
): Readonly<{ entryId: bigint; text: string }> {
  const entryId = (highest.get(session) ?? 0n) + 1n;
  if (entryId > MAX_CORRELATION) throw new InputCommitCorrelationExhausted();
  highest.set(session, entryId);
  // Primitive bigint template conversion has no user toString/getter callout.
  return Object.freeze({ entryId, text: `${entryId}` });
}
