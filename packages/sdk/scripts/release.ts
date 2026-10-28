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

const manifestPath = path.resolve(import.meta.dir, '..', 'package.json');

export interface Manifest {
  name: string;
  version: string;
}

export async function readManifest(): Promise<Manifest> {
  return JSON.parse(await Bun.file(manifestPath).text()) as Manifest;
}

/**
 * Rewrite the single field rather than re-serializing the manifest: key order,
 * formatting, and the trailing newline stay byte-identical.
 */
export async function writeVersion(version: string): Promise<void> {
  const source = await Bun.file(manifestPath).text();
  const updated = source.replace(
    /("version"\s*:\s*")[^"]+(")/,
    (_match, open: string, close: string) => `${open}${version}${close}`,
  );
  if (updated === source) {
    throw new Error('could not find the version field in package.json');
  }
  await Bun.write(manifestPath, updated);
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
    tag: `sdk-v${version}`,
    // A prerelease must not become what `npm install` resolves to.
    distTag: semver.prerelease(version) === null ? 'latest' : 'next',
  };
}
