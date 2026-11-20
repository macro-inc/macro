import { expect, test } from 'bun:test';
import { attributionProblem, mintWakeId, wakeInstant } from '../attribution.ts';

const now = Temporal.Instant.from('2026-11-11T12:00:00Z');
const bytes = new Uint8Array(10).fill(0xab);

test('a minted wake id is a UUIDv7 carrying its instant', () => {
  const id = mintWakeId(now, bytes);
  expect(id).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
  );
  expect(wakeInstant(id)?.equals(now)).toBe(true);
  expect(wakeInstant(crypto.randomUUID())).toBeUndefined();
});

test('the vault takes wake ids from 24 hours back to 5 minutes ahead, inclusive', () => {
  const at = (duration: Temporal.DurationLike) =>
    mintWakeId(now.add(duration), bytes);
  expect(attributionProblem(at({ hours: -24 }), now)).toBeUndefined();
  expect(attributionProblem(at({ minutes: 5 }), now)).toBeUndefined();
  expect(attributionProblem(at({ hours: -24, seconds: -1 }), now)).toBe(
    'out of range'
  );
  expect(attributionProblem(at({ minutes: 5, seconds: 1 }), now)).toBe(
    'out of range'
  );
  expect(attributionProblem(crypto.randomUUID(), now)).toBe('not a UUIDv7');
  expect(attributionProblem(null, now)).toBe('missing');
});
