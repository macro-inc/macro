// What "the Android native code" is, shared by the PR-time version check
// (android-version-check.mjs) and the release-time build decision
// (android-release-needed.mjs) so the two can never disagree: a PR that
// passes the gate must not fail the release for the same question.
//
// It is every tracked file under apps/web/tauri except what never reaches
// the Android binary — iOS, macOS, Linux, Windows and desktop-only paths by
// naming convention (a path component or extension naming the platform, the
// generated Xcode project under gen/apple, the desktop updater manifest,
// editor config) — plus one thing outside that tree: the version of the
// client cache wasm package. The app compiles the cache crates natively, and
// the team bumps that version when a cache change must ship, so the bump
// counts as a native change while other edits under crates/client do not.
// The iOS gate (tooling/xtask/.../scripts/ios_native_tree.sh) is the mirror
// image, excluding Android-only paths instead.

import { execFileSync } from 'node:child_process';

export const tauriPath = 'apps/web/tauri';
export const cacheWasmManifest = 'crates/client/cache-wasm/Cargo.toml';
export const androidExclude =
  /(^|\/)(ios|macos|linux|windows|apple|desktop)([_./-]|$)|\.(ios|macos|linux|windows)\.|^desktop-release\.json$|^\.helix\//;

/// A `git` runner bound to a working directory.
export function gitIn(cwd) {
  return (args, input) =>
    execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      input,
      maxBuffer: 64 * 1024 * 1024,
      stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
    }).trim();
}

/// The `version` of the client cache wasm package at a commit ("none" before
/// the package existed).
export function cacheWasmVersion(git, commit) {
  try {
    return (
      git(['show', `${commit}:${cacheWasmManifest}`]).match(
        /^version\s*=\s*"([^"]*)"/m
      )?.[1] ?? 'none'
    );
  } catch {
    return 'none';
  }
}

/// The Android-relevant part of the Tauri tree at a commit: `git ls-tree -r`
/// lines (mode, type, blob, path relative to apps/web/tauri) minus the
/// excluded paths. Hashable and diffable.
export function androidTreeListing(git, commit) {
  return git(['ls-tree', '-r', '--full-tree', `${commit}:${tauriPath}`])
    .split('\n')
    .filter((line) => line && !androidExclude.test(line.split('\t')[1]));
}

/// One hash for "the Android native code" at a commit: the listing above
/// plus the cache wasm version. Equal hashes mean no native change.
export function androidNativeHash(git, commit) {
  const content = [
    ...androidTreeListing(git, commit),
    `cache-wasm-version ${cacheWasmVersion(git, commit)}`,
  ].join('\n');
  return git(['hash-object', '--stdin'], `${content}\n`);
}

/// Why two commits differ, for messages: which of the two signals moved.
export function androidChangeReasons(git, from, to) {
  const reasons = [];
  if (
    androidTreeListing(git, from).join('\n') !==
    androidTreeListing(git, to).join('\n')
  )
    reasons.push(`Android-relevant files under ${tauriPath}/ changed`);
  const before = cacheWasmVersion(git, from);
  const after = cacheWasmVersion(git, to);
  if (before !== after)
    reasons.push(
      `the client cache wasm version moved (${before} → ${after})`
    );
  return reasons;
}

/// The Android versionCode committed at a commit, validated.
export function androidVersionCode(git, commit) {
  const config = JSON.parse(
    git(['show', `${commit}:${tauriPath}/src-tauri/tauri.android.conf.json`])
  );
  const code = config.bundle?.android?.versionCode;
  if (!Number.isInteger(code) || code < 1 || code > 2_100_000_000)
    throw new Error(`Invalid Android versionCode at ${commit}`);
  return code;
}
