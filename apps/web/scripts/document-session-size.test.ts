import { randomBytes } from 'node:crypto';
import { expect, test } from 'vitest';
import { inspectSessionSize } from './document-session-size';

test('valid wasm over the soft ceiling remains eligible for measured speed gains', () => {
  // Valid custom section with incompressible bytes exercises real compression.
  const payload = randomBytes(1_700_000);
  const bytes = new Uint8Array(1_700_013);
  bytes.set([0, 97, 115, 109, 1, 0, 0, 0, 0, 161, 225, 103, 0]);
  bytes.set(payload, 13);
  const size = inspectSessionSize(bytes);
  expect(size.raw).toBe(1_700_013);
  expect(size.brotliSoftCeiling).toBe(1_600_000);
  expect(size.brotli).toBeGreaterThan(1_600_000);
  expect(size.aboveSoftCeiling).toBe(true);
});

test('invalid artifacts fail even when small', () => {
  expect(() => inspectSessionSize(new Uint8Array([0, 1, 2, 3]))).toThrow(
    'Invalid session wasm artifact'
  );
  expect(inspectSessionSize(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]))).toMatchObject({
    raw: 8,
    aboveSoftCeiling: false,
  });
});
