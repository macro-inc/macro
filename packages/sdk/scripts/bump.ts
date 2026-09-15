/**
 * Raise the `version` field in package.json. Merging that bump to `main` is
 * what publishes the package — see RELEASING.md and the `Release SDK` workflow.
 *
 * Usage: `bun scripts/bump.ts patch|minor|major` or `bun scripts/bump.ts X.Y.Z`.
 */
import * as path from 'node:path';

const levels = ['patch', 'minor', 'major'] as const;
type Level = (typeof levels)[number];

const isLevel = (value: string): value is Level =>
  (levels as readonly string[]).includes(value);

const manifestPath = path.resolve(import.meta.dir, '..', 'package.json');
const registry = 'https://registry.npmjs.org';

/** Parse `X.Y.Z`, rejecting prereleases: those are bumped by hand. */
function parse(version: string): [number, number, number] {
  const parts = version.split('.').map(Number);
  if (
    parts.length !== 3 ||
    parts.some((part) => !Number.isInteger(part) || part < 0)
  ) {
    throw new Error(
      `cannot bump non-release version ${version}; edit package.json directly`,
    );
  }
  return [parts[0] as number, parts[1] as number, parts[2] as number];
}

function next(current: string, level: Level): string {
  const [major, minor, patch] = parse(current);
  switch (level) {
    case 'major':
      return `${major + 1}.0.0`;
    case 'minor':
      return `${major}.${minor + 1}.0`;
    case 'patch':
      return `${major}.${minor}.${patch + 1}`;
  }
}

/** The registry is the source of truth for what is taken; offline is not fatal. */
async function publishedVersions(name: string): Promise<string[] | undefined> {
  const response = await fetch(`${registry}/${name.replace('/', '%2F')}`).catch(
    () => undefined,
  );
  if (!response?.ok) return undefined;
  const packument = (await response.json()) as {
    versions?: Record<string, unknown>;
  };
  return Object.keys(packument.versions ?? {});
}

const argument = process.argv[2] ?? 'patch';
const manifestSource = await Bun.file(manifestPath).text();
const manifest = JSON.parse(manifestSource) as {
  name: string;
  version: string;
};

const target = isLevel(argument) ? next(manifest.version, argument) : argument;
if (!isLevel(argument)) parse(target);

const published = await publishedVersions(manifest.name);
if (published === undefined) {
  console.warn(
    `could not reach ${registry}; not checking whether ${target} is taken`,
  );
} else if (published.includes(target)) {
  throw new Error(`${manifest.name}@${target} is already published`);
}

// Rewrite the single field rather than re-serializing: keeps key order,
// formatting, and the trailing newline byte-identical.
const updated = manifestSource.replace(
  /("version"\s*:\s*")[^"]+(")/,
  (_match, open: string, close: string) => `${open}${target}${close}`,
);
if (updated === manifestSource) {
  throw new Error('could not find the version field in package.json');
}
await Bun.write(manifestPath, updated);

console.log(`${manifest.version} -> ${target}`);
console.log('commit this with the SDK change; merging it to main publishes.');
