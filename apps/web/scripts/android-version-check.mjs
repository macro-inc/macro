// PR-time gate: a PR whose merge result changes the Android native code (as
// defined in android-native.mjs) must bump the Android versionCode above the
// base branch. The release workflow applies the same definition when it
// decides whether a production release needs a new App Bundle; catching a
// missing bump here keeps it from failing there, after the deploy.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  androidChangeReasons,
  androidNativeHash,
  androidVersionCode,
  gitIn,
} from './android-native.mjs';

export function checkAndroidVersion({
  base,
  head = 'HEAD',
  cwd = process.cwd(),
}) {
  if (!base) throw new Error('Provide the PR base commit');
  const git = gitIn(cwd);
  const baseCommit = git([
    'rev-parse',
    '--verify',
    '--end-of-options',
    `${base}^{commit}`,
  ]);
  const headCommit = git([
    'rev-parse',
    '--verify',
    '--end-of-options',
    `${head}^{commit}`,
  ]);
  if (androidNativeHash(git, baseCommit) === androidNativeHash(git, headCommit))
    return 'No Android native changes; no Android version bump needed.';

  const reason = androidChangeReasons(git, baseCommit, headCommit).join(
    ' and '
  );
  const previous = androidVersionCode(git, baseCommit);
  const next = androidVersionCode(git, headCommit);
  if (next <= previous)
    throw new Error(
      `${reason}, but Android versionCode (${next}) must exceed the base branch (${previous}). Run just android-bump in apps/web and commit the result before merging.`
    );
  return `${reason}; Android versionCode increased from ${previous} to ${next}.`;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    console.log(checkAndroidVersion({ base: process.argv[2] }));
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : 'Android version check failed'
    );
    process.exitCode = 1;
  }
}
