/**
 * Raise the `version` field in package.json. Merging that bump to `main` is
 * what publishes the package — see RELEASING.md and the `Release SDK` workflow.
 *
 * Usage: `bun scripts/bump.ts patch|minor|major` or `bun scripts/bump.ts X.Y.Z`.
 */
import semver, { type ReleaseType } from 'semver';
import {
  publishedVersions,
  readManifest,
  resolveRelease,
  writeVersion,
} from './release';

const releaseTypes: ReleaseType[] = ['patch', 'minor', 'major'];

const isReleaseType = (value: string): value is ReleaseType =>
  (releaseTypes as string[]).includes(value);

const argument = process.argv[2] ?? 'patch';
const manifest = await readManifest();

const target = isReleaseType(argument)
  ? semver.inc(manifest.version, argument)
  : argument;
if (target === null) {
  throw new Error(`cannot ${argument}-bump ${manifest.version}`);
}

const resolution = resolveRelease(
  target,
  await publishedVersions(manifest.name),
);
if (resolution.kind === 'published') {
  throw new Error(`${manifest.name}@${target} is already published`);
}
if (resolution.kind === 'rejected') {
  throw new Error(resolution.reason);
}

await writeVersion(target);

console.log(`${manifest.version} -> ${target}`);
if (resolution.distTag !== 'latest') {
  console.log(
    `prerelease: will publish under the '${resolution.distTag}' dist-tag.`,
  );
}
console.log('commit this with the SDK change; merging it to main publishes.');
