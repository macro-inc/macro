import { randomBytes } from 'node:crypto';
import { expect, test } from 'vitest';
import { inspectSessionSize } from './document-session-size';

test('valid wasm over the soft ceiling remains eligible for measured speed gains', () => {
  // Valid custom section with incompressible bytes exercises real compression.
  const payload = randomBytes(2_300_000);
  const bytes = new Uint8Array(2_300_014);
  bytes.set([0, 97, 115, 109, 1, 0, 0, 0, 0, 225, 176, 140, 1, 0]);
  bytes.set(payload, 14);
  const size = inspectSessionSize(bytes);
  expect(size.raw).toBe(2_300_014);
  expect(size.brotliSoftCeiling).toBe(2_200_000);
  expect(size.brotli).toBeGreaterThan(2_200_000);
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
