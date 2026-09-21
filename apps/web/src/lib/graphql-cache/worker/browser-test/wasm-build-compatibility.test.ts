import { describe, expect, it } from 'vitest';
import {
  assertMatchingCacheWasmBuilds,
  type CacheWasmBuildInfo,
} from './wasm-build-compatibility';

const current: CacheWasmBuildInfo = {
  packageVersion: '0.6.15',
  schemaHash: 'a'.repeat(64),
  schemaCompatibilityEpoch: 2,
  formatVersion: 3,
  storageSchemaVersion: 11,
};
const source = (value: unknown) => ({ cacheBuildInfo: () => value });

describe('recovery fixture artifact compatibility', () => {
  it('accepts a matched pair of embedded build identities', () => {
    expect(
      assertMatchingCacheWasmBuilds(source(current), source({ ...current }))
    ).toEqual(current);
  });

  it.each([
    { packageVersion: '0.6.4' },
    { schemaHash: 'b'.repeat(64) },
    { schemaCompatibilityEpoch: 1 },
    { formatVersion: 2 },
    { storageSchemaVersion: 10 },
  ])('rejects a differing build field: %j', (difference) => {
    expect(() =>
      assertMatchingCacheWasmBuilds(
        source(current),
        source({ ...current, ...difference })
      )
    ).toThrow('Cache recovery fixture WASM mismatch');
  });

  it('identifies the incompatible artifacts and the rebuild command', () => {
    expect(() =>
      assertMatchingCacheWasmBuilds(
        source(current),
        source({ ...current, packageVersion: '0.6.4', formatVersion: 2 })
      )
    ).toThrow(
      /Production: cache-wasm 0\.6\.15, s2:v3.*Browser-test hooks: cache-wasm 0\.6\.4, s2:v2.*just build-cache-wasm-browser-production/
    );
  });

  it.each(['production', 'browser-test hooks'])(
    'diagnoses a stale %s binary missing the export',
    (label) => {
      const sources =
        label === 'production' ? [{}, source(current)] : [source(current), {}];
      expect(() =>
        assertMatchingCacheWasmBuilds(sources[0], sources[1])
      ).toThrow(`${label} is missing cacheBuildInfo (stale WASM artifact)`);
    }
  );

  it.each([
    null,
    {},
    { ...current, formatVersion: '3' },
    { ...current, storageSchemaVersion: NaN },
    { ...current, schemaCompatibilityEpoch: -1 },
  ])('rejects malformed metadata: %j', (metadata) => {
    expect(() =>
      assertMatchingCacheWasmBuilds(source(current), source(metadata))
    ).toThrow('browser-test hooks returned invalid cacheBuildInfo');
  });
});
