/**
 * Release state shared by `bump.ts` (local) and `resolve-release.ts` (CI).
 *
 * Releasing is merging a version bump, so the same question — "is this version
 * a legal next release?" — is asked once before the PR and once on `main`.
 * Version comparison is left to `semver`; only the policy lives here.
 */
import * as path from 'node:path';
import semver from 'semver';

export const registry = 'https://registry.npmjs.org';

const sdkManifestPath = path.resolve(import.meta.dir, '..', 'package.json');
const callsManifestPath = path.resolve(
  import.meta.dir,
  '../../sdk-calls/package.json',
);

export const sdkPackage = '@macro-inc/sdk';

export interface Manifest {
  name: string;
  version: string;
  peerDependencies?: Record<string, string>;
}

async function readManifestAt(file: string): Promise<Manifest> {
  return JSON.parse(await Bun.file(file).text()) as Manifest;
}

export function readManifest(): Promise<Manifest> {
  return readManifestAt(sdkManifestPath);
}

export function readCallsManifest(): Promise<Manifest> {
  return readManifestAt(callsManifestPath);
}

/** The peer range `@macro-inc/sdk-calls` must declare for an SDK version. */
export function callsPeerRange(version: string): string {
  return `^${version}`;
}

/**
 * Why the two manifests can't release together, if they can't. The packages
 * version in lockstep (see RELEASING.md), so a stale peer range can't send
 * installs to an SDK without the API `@macro-inc/sdk-calls` needs.
 */
export function lockstepProblem(
  sdk: Manifest,
  calls: Manifest,
): string | undefined {
  if (sdk.version !== calls.version) {
    return `${calls.name} is at ${calls.version} but ${sdk.name} is at ${sdk.version}; run \`just bump\` in packages/sdk`;
  }
  const declared = calls.peerDependencies?.[sdkPackage];
  const expected = callsPeerRange(sdk.version);
  if (declared !== expected) {
    return `${calls.name} declares ${sdkPackage}@${declared} but must declare ${expected}`;
  }
  return undefined;
}

function replaceOnce(source: string, pattern: RegExp, value: string): string {
  const updated = source.replace(
    pattern,
    (_match, open: string, close: string) => `${open}${value}${close}`,
  );
  if (!pattern.test(source)) {
    throw new Error(`could not find ${pattern} in package.json`);
  }
  return updated;
}

/**
 * Rewrite the single fields rather than re-serializing the manifests: key
 * order, formatting, and the trailing newline stay byte-identical.
 */
export async function writeVersion(version: string): Promise<void> {
  const versionField = /("version"\s*:\s*")[^"]+(")/;
  await Bun.write(
    sdkManifestPath,
    replaceOnce(await Bun.file(sdkManifestPath).text(), versionField, version),
  );
  await Bun.write(
    callsManifestPath,
    replaceOnce(
      replaceOnce(
        await Bun.file(callsManifestPath).text(),
        versionField,
        version,
      ),
      /("@macro-inc\/sdk"\s*:\s*")[^"]+(")/,
      callsPeerRange(version),
    ),
  );
}

/** Every version the registry holds. Throws rather than guessing when offline. */
export async function publishedVersions(name: string): Promise<string[]> {
  const response = await fetch(`${registry}/${name.replace('/', '%2F')}`);
  if (response.status === 404) return [];
  if (!response.ok) {
    throw new Error(`${registry} answered ${response.status} for ${name}`);
  }
  const packument = (await response.json()) as {
    versions?: Record<string, unknown>;
  };
  return Object.keys(packument.versions ?? {});
}

export type Resolution =
  | { kind: 'release'; version: string; tag: string; distTag: string }
  | { kind: 'published'; version: string }
  | { kind: 'rejected'; version: string; reason: string };

/**
 * Decide what a version on `main` means. An already published version is a
 * no-op — a re-run, a revert, or an unrelated manifest edit must not fail. A
 * version below what npm already serves is rejected: that is a downgrade
 * nobody intended, and publishing it would move the `latest` dist-tag
 * backwards.
 */
export function resolveRelease(
  version: string,
  published: readonly string[],
  tagPrefix = 'sdk',
): Resolution {
  if (semver.valid(version) === null) {
    return {
      kind: 'rejected',
      version,
      reason: `${version} is not valid semver`,
    };
  }
  if (published.includes(version)) {
    return { kind: 'published', version };
  }

  const highest = semver.rsort([...published])[0];
  if (highest !== undefined && semver.lt(version, highest)) {
    return {
      kind: 'rejected',
      version,
      reason: `${version} is below the published ${highest}`,
    };
  }

  return {
    kind: 'release',
    version,
    tag: `${tagPrefix}-v${version}`,
    // A prerelease must not become what `npm install` resolves to.
    distTag: semver.prerelease(version) === null ? 'latest' : 'next',
  };
}
