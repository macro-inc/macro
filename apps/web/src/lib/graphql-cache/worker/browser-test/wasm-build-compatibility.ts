/** Embedded binary metadata, not the adjacent generated package.json. */
export type CacheWasmBuildInfo = {
  packageVersion: string;
  schemaHash: string;
  schemaCompatibilityEpoch: number;
  formatVersion: number;
  storageSchemaVersion: number;
};

export type CacheWasmBuildInfoSource = {
  cacheBuildInfo?: () => unknown;
};

const REBUILD_INSTRUCTION =
  'Rebuild both artifacts from the same checkout: run just build-cache-wasm-browser-production in apps/web.';

function readBuildInfo(
  source: CacheWasmBuildInfoSource,
  label: string
): CacheWasmBuildInfo {
  if (typeof source.cacheBuildInfo !== 'function') {
    throw new Error(
      `Cache recovery fixture: ${label} is missing cacheBuildInfo (stale WASM artifact). ${REBUILD_INSTRUCTION}`
    );
  }
  const info = source.cacheBuildInfo();
  if (
    typeof info !== 'object' ||
    info === null ||
    !('packageVersion' in info) ||
    typeof info.packageVersion !== 'string' ||
    !info.packageVersion ||
    !('schemaHash' in info) ||
    typeof info.schemaHash !== 'string' ||
    !info.schemaHash ||
    !('schemaCompatibilityEpoch' in info) ||
    !isVersion(info.schemaCompatibilityEpoch) ||
    !('formatVersion' in info) ||
    !isVersion(info.formatVersion) ||
    !('storageSchemaVersion' in info) ||
    !isVersion(info.storageSchemaVersion)
  ) {
    throw new Error(
      `Cache recovery fixture: ${label} returned invalid cacheBuildInfo. ${REBUILD_INSTRUCTION}`
    );
  }
  return {
    packageVersion: info.packageVersion,
    schemaHash: info.schemaHash,
    schemaCompatibilityEpoch: info.schemaCompatibilityEpoch,
    formatVersion: info.formatVersion,
    storageSchemaVersion: info.storageSchemaVersion,
  };
}

function isVersion(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function describeBuild(info: CacheWasmBuildInfo): string {
  return `cache-wasm ${info.packageVersion}, s${info.schemaCompatibilityEpoch}:v${info.formatVersion}, storage schema ${info.storageSchemaVersion}, GraphQL schema ${info.schemaHash}`;
}

/** Fault injection requires a matched build pair, intentionally stricter than
 * normal cache compatibility (where additive GraphQL changes are permitted).
 * This check never opens, validates, or resets a database.
 */
export function assertMatchingCacheWasmBuilds(
  production: CacheWasmBuildInfoSource,
  hooks: CacheWasmBuildInfoSource
): CacheWasmBuildInfo {
  const expected = readBuildInfo(production, 'production');
  const actual = readBuildInfo(hooks, 'browser-test hooks');
  if (
    expected.packageVersion !== actual.packageVersion ||
    expected.schemaHash !== actual.schemaHash ||
    expected.schemaCompatibilityEpoch !== actual.schemaCompatibilityEpoch ||
    expected.formatVersion !== actual.formatVersion ||
    expected.storageSchemaVersion !== actual.storageSchemaVersion
  ) {
    throw new Error(
      `Cache recovery fixture WASM mismatch. Production: ${describeBuild(expected)}. Browser-test hooks: ${describeBuild(actual)}. ${REBUILD_INSTRUCTION}`
    );
  }
  return expected;
}
