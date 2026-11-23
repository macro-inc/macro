/**
 * The wake a vault call belongs to: a UUIDv7, which the vault takes as
 * untrusted correlation and checks only for its version and its time.
 */

const uuidV7 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** How far from the vault's own clock a wake id may be. */
export const window = {
  behind: Temporal.Duration.from({ hours: 24 }),
  ahead: Temporal.Duration.from({ minutes: 5 }),
};

const hex = (bytes: Uint8Array): string =>
  [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');

/** A UUIDv7 for `at`, from ten random bytes. */
export const mintWakeId = (
  at: Temporal.Instant,
  random: Uint8Array
): string => {
  const time = BigInt(at.epochMilliseconds).toString(16).padStart(12, '0');
  const bytes = Uint8Array.from(
    { length: 10 },
    (_, index) => random[index] ?? 0
  );
  // Version 7 in the high nibble of byte 6, variant 10 in the high bits of byte 8.
  bytes[0] = ((bytes[0] ?? 0) & 0x0f) | 0x70;
  bytes[2] = ((bytes[2] ?? 0) & 0x3f) | 0x80;
  const rest = hex(bytes);
  return [
    time.slice(0, 8),
    time.slice(8, 12),
    rest.slice(0, 4),
    rest.slice(4, 8),
    rest.slice(8, 20),
  ].join('-');
};

/** The instant a UUIDv7 was minted at, or undefined if it isn't one. */
export const wakeInstant = (id: string): Temporal.Instant | undefined => {
  if (!uuidV7.test(id)) return undefined;
  const milliseconds = Number.parseInt(id.replaceAll('-', '').slice(0, 12), 16);
  return Temporal.Instant.fromEpochMilliseconds(milliseconds);
};

/** What is wrong with a wake id the vault is given at `now`, or undefined if nothing is. */
export const attributionProblem = (
  id: string | null,
  now: Temporal.Instant
): 'missing' | 'not a UUIDv7' | 'out of range' | undefined => {
  if (id === null || id === '') return 'missing';
  const at = wakeInstant(id);
  if (at === undefined) return 'not a UUIDv7';
  const early = Temporal.Instant.compare(at, now.subtract(window.behind)) < 0;
  const late = Temporal.Instant.compare(at, now.add(window.ahead)) > 0;
  return early || late ? 'out of range' : undefined;
};
