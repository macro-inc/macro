// PR-time gate: a PR whose merge result changes the Android native code (as
// defined in android-native.mjs) must bump the Android versionCode above the
// base branch. The release workflow applies the same definition when it
// decides whether a production release needs a new App Bundle; catching a
// missing bump here keeps it from failing there, after the deploy.
//
// The Android floor in min-native-build.json must then be either the new
// versionCode (`just android-bump`: the next production web deploy stops
// serving shared JS to older installs and prompts them to update) or left as
// the base has it (`just android-bump --no-min`: a release older installs
// don't need). A PR without Android native changes releases nothing, so it
// may raise the floor only as far as the base's versionCode, a version that
// already went through this gate. A PR labelled skip-android-update never
// releases either, so with --skip-release the floor must not rise above the
// base's: either would prompt older installs to update to a version Play
// never published.
import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  androidChangeReasons,
  androidNativeHash,
  androidVersionCode,
  gitIn,
} from './android-native.mjs';

const minNativeBuildPath = 'apps/web/min-native-build.json';

/// The Android floor committed in min-native-build.json at a commit, validated.
function androidNativeBuildFloor(git, commit) {
  const floor = JSON.parse(git(['show', `${commit}:${minNativeBuildPath}`]))
    .android;
  if (!Number.isInteger(floor) || floor < 1)
    throw new Error(`Invalid Android native build floor at ${commit}`);
  return floor;
}

function resolveCommits(git, base, head) {
  if (!base) throw new Error('Provide the PR base commit');
  const resolve = (ref) =>
    git(['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`]);
  return { baseCommit: resolve(base), headCommit: resolve(head) };
}

export function checkAndroidVersion({
  base,
  head = 'HEAD',
  cwd = process.cwd(),
}) {
  const git = gitIn(cwd);
  const { baseCommit, headCommit } = resolveCommits(git, base, head);
  const output = (changed) => {
    if (process.env.GITHUB_OUTPUT)
      appendFileSync(
        process.env.GITHUB_OUTPUT,
        `changed=${changed}\nversion_code=${androidVersionCode(git, headCommit)}\n`
      );
  };
  const previous = androidVersionCode(git, baseCommit);
  const baseFloor = androidNativeBuildFloor(git, baseCommit);
  const floor = androidNativeBuildFloor(git, headCommit);
  if (androidNativeHash(git, baseCommit) === androidNativeHash(git, headCommit)) {
    output(false);
    if (floor > baseFloor && floor > previous)
      throw new Error(
        `min-native-build.json raises the Android native build floor to ${floor}, above the base branch's versionCode ${previous}, but this PR has no Android native changes and releases nothing: after the production deploy, Android installs below it would be prompted to update to a version that was never published. Raise the floor only to a released versionCode.`
      );
    return 'No Android native changes; no Android version bump needed.';
  }
  output(true);

  const reason = androidChangeReasons(git, baseCommit, headCommit).join(
    ' and '
  );
  const next = androidVersionCode(git, headCommit);
  if (next <= previous)
    throw new Error(
      `${reason}, but Android versionCode (${next}) must exceed the base branch (${previous}). Run just android-bump in apps/web and commit the result before merging.`
    );
  if (floor !== next && floor !== baseFloor)
    throw new Error(
      `min-native-build.json has android ${floor}; expected the new versionCode ${next}, so older Android installs are prompted to update after the production deploy, or ${baseFloor}, unchanged from the base branch, for a release older installs don't need. Run just android-bump (or just android-bump --no-min) in apps/web.`
    );
  const floorNote =
    floor === next
      ? `raising the Android native build floor to ${next}`
      : `keeping the Android native build floor at ${floor}`;
  return `${reason}; Android versionCode increased from ${previous} to ${next}, ${floorNote}.`;
}

/// The skip-android-update twin: such a PR never releases to Google Play, so
/// it must not raise the Android floor above the base's.
export function checkAndroidFloorKept({
  base,
  head = 'HEAD',
  cwd = process.cwd(),
}) {
  const git = gitIn(cwd);
  const { baseCommit, headCommit } = resolveCommits(git, base, head);
  const baseFloor = androidNativeBuildFloor(git, baseCommit);
  const floor = androidNativeBuildFloor(git, headCommit);
  if (floor > baseFloor)
    throw new Error(
      `skip-android-update PRs never release to Google Play, but min-native-build.json raises the Android native build floor from ${baseFloor} to ${floor}: after the production deploy, Android installs below it would be prompted to update to a version that was never published. Restore the base's floor (just android-bump --no-min keeps it), or remove the label and release.`
    );
  return `Android native build floor ${floor} does not exceed the base branch's (${baseFloor}).`;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    const args = process.argv.slice(2);
    console.log(
      args[0] === '--skip-release'
        ? checkAndroidFloorKept({ base: args[1] })
        : checkAndroidVersion({ base: args[0] })
    );
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : 'Android version check failed'
    );
    process.exitCode = 1;
  }
}
