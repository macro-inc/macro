// What "the Android native code" is, shared by the PR gate
// (android-version-check.mjs), the Play release workflow's preconditions,
// head guard and provenance stamp, the drift check and the watcher (all
// through the `hash` CLI below) so they can never disagree about whether a
// change is native.
//
// It is every tracked file under apps/web/tauri except what never reaches
// the Android binary — iOS, macOS, Linux, Windows and desktop-only paths by
// naming convention (a path component or extension naming the platform, the
// generated Xcode project under gen/apple, the desktop updater manifest,
// editor config, Markdown docs) — plus one thing outside that tree: the
// version of the client cache wasm package. The app compiles the cache crates natively, and
// the team bumps that version when a cache change must ship, so the bump
// counts as a native change while other edits under crates/client do not.
// The iOS gate (tooling/xtask/.../scripts/ios_native_tree.sh) is the mirror
// image, excluding Android-only and desktop-only paths instead.

import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const tauriPath = 'apps/web/tauri';
export const cacheWasmManifest = 'crates/client/cache-wasm/Cargo.toml';
export const androidExclude =
  /(^|\/)(ios|macos|linux|windows|apple|desktop)([_./-]|$)|\.(ios|macos|linux|windows)\.|\.md$|^desktop-release\.json$|^\.helix\//;

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

// CLI for the workflows' shell steps:
//   bun scripts/android-native.mjs hash [commit]          the native hash
//   bun scripts/android-native.mjs version-code [commit]  the versionCode
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    const [command, commit = 'HEAD'] = process.argv.slice(2);
    const git = gitIn(process.cwd());
    const resolved = git(['rev-parse', '--verify', '--end-of-options', `${commit}^{commit}`]);
    if (command === 'hash') console.log(androidNativeHash(git, resolved));
    else if (command === 'version-code') console.log(androidVersionCode(git, resolved));
    else throw new Error('Usage: android-native.mjs hash|version-code [commit]');
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'android-native failed');
    process.exitCode = 1;
  }
}
