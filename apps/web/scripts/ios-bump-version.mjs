// Bump the iOS release numbers in one place, then sync the generated Apple
// project metadata so everything stays consistent:
//
//   default          App Store release for a breaking native change (the
//                    `ios-update` PR flow): bump the marketing version's
//                    patch component and the build number, and raise the iOS
//                    floor in min-native-build.json to the new build number so
//                    the next prod web deploy (`just build-prod` →
//                    MIN_NATIVE_BUILD_IOS) refuses to run on older native
//                    builds and prompts the App Store update.
//   --no-min         App Store release that does NOT break older native
//                    builds: bump marketing version + build number only.
//   --build-only     TestFlight iteration: bump only the build number
//                    (same marketing version; used by ios-release.sh).
//
// The new build number is one above the larger of the committed number and
// the highest build App Store Connect has ever seen for the app (hand-made
// releases don't always get committed, and the native build floor assumes
// numbers only go up). The marketing version only moves once the committed
// one has actually been released: a re-release after native changes (whose
// first submission was withdrawn) keeps its version and just takes a new
// build number. Both need the App Store Connect credentials:
//   doppler run --project ios-release --config prd -- just ios-bump
// Without them the bump still works but warns: the build number is
// unverified and the marketing version is bumped unconditionally (safe, if
// sometimes unnecessary).
//
// Writes: tauri/src-tauri/tauri.ios.conf.json, min-native-build.json, and the
// synced gen/apple plists + project.yml (via sync-ios-bundle-metadata.mjs).
// Commit all of them.

import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { exit } from "node:process";
import { fileURLToPath } from "node:url";

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const iosConfPath = path.join(appDir, "tauri", "src-tauri", "tauri.ios.conf.json");
const minNativeBuildPath = path.join(appDir, "min-native-build.json");

const flags = new Set(process.argv.slice(2));
for (const flag of flags) {
  if (!["--no-min", "--build-only"].includes(flag)) {
    console.error(`Unknown argument: ${flag}. Usage: ios-bump-version.mjs [--no-min|--build-only]`);
    exit(2);
  }
}
if (flags.has("--no-min") && flags.has("--build-only")) {
  console.error("--no-min and --build-only are mutually exclusive.");
  exit(2);
}
const buildOnly = flags.has("--build-only");
const raiseMinNativeBuild = !buildOnly && !flags.has("--no-min");

const iosConf = JSON.parse(readFileSync(iosConfPath, "utf8"));

/// What App Store Connect knows (see `ios-app-store.mjs release-info`), or
/// null when no credentials are available (with a warning — a stale committed
/// number would then go unnoticed).
function releaseInfo() {
  const hasCredentials =
    (process.env.APPLE_API_KEY || process.env.APPLE_API_KEY_ID) && process.env.APPLE_API_ISSUER;
  if (!hasCredentials) {
    console.warn(
      "WARNING: no App Store Connect credentials, so the new build number is only " +
        "based on the committed one (a release made by hand without committing its " +
        "number would collide) and the marketing version is bumped unconditionally. " +
        "To be safe, run:\n  doppler run --project ios-release --config prd -- just ios-bump",
    );
    return null;
  }
  const output = execFileSync(
    "bun",
    [path.join(appDir, "scripts", "ios-app-store.mjs"), "release-info"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
  ).trim();
  try {
    return JSON.parse(output);
  } catch {
    console.error(`Unexpected release-info output: ${JSON.stringify(output)}`);
    exit(1);
  }
}

function versionTriple(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version ?? "");
  return match ? match.slice(1).map(Number) : null;
}

function compareVersions(a, b) {
  const [ta, tb] = [versionTriple(a) ?? [0, 0, 0], versionTriple(b) ?? [0, 0, 0]];
  for (let i = 0; i < 3; i += 1) {
    if (ta[i] !== tb[i]) return ta[i] - tb[i];
  }
  return 0;
}

const currentBuild = iosConf.bundle?.iOS?.bundleVersion;
if (!/^\d+$/.test(currentBuild ?? "")) {
  console.error(
    `bundleVersion ${JSON.stringify(currentBuild)} in ${path.relative(appDir, iosConfPath)} ` +
      "is not a plain integer; fix it manually before bumping.",
  );
  exit(1);
}
const info = releaseInfo();
const uploadedBuild = info?.highestBuild ?? null;
if (uploadedBuild !== null && uploadedBuild > Number(currentBuild)) {
  console.log(
    `App Store Connect already has build ${uploadedBuild}, above the committed ` +
      `${currentBuild} (a release made by hand?); bumping past it.`,
  );
}
const newBuild = String(Math.max(Number(currentBuild), uploadedBuild ?? 0) + 1);
iosConf.bundle.iOS.bundleVersion = newBuild;

let newVersion = iosConf.version;
if (!buildOnly) {
  if (!versionTriple(iosConf.version)) {
    console.error(
      `version ${JSON.stringify(iosConf.version)} in ${path.relative(appDir, iosConfPath)} ` +
        'is not of the form "major.minor.patch"; fix it manually before bumping.',
    );
    exit(1);
  }
  // A higher version already on the store (a hand release) makes the
  // committed string unusable even if it never shipped: App Store Connect
  // refuses version strings at or below the latest release.
  const higherShipped = info && compareVersions(info.highestVersion, iosConf.version) > 0;
  if (info && !info.versionReleased && !higherShipped) {
    console.log(
      `Version ${iosConf.version} has not been released to the App Store ` +
        `(${info.versionState ?? "no App Store record"}); keeping it.`,
    );
  } else {
    if (info && !info.versionReleased && higherShipped) {
      console.log(
        `Version ${iosConf.version} was never released, but App Store Connect already ` +
          `has ${info.highestVersion} above it.`,
      );
    }
    // Released (or unknown): next patch above both the committed version and
    // the highest version App Store Connect has (a hand release that was
    // never committed).
    const base =
      info && compareVersions(info.highestVersion, iosConf.version) > 0
        ? info.highestVersion
        : iosConf.version;
    if (base !== iosConf.version) {
      console.log(`App Store Connect already has version ${base}; bumping past it.`);
    }
    const [major, minor, patch] = versionTriple(base);
    newVersion = `${major}.${minor}.${patch + 1}`;
    iosConf.version = newVersion;
  }
}

writeFileSync(iosConfPath, `${JSON.stringify(iosConf, null, 2)}\n`);
console.log(
  buildOnly
    ? `Bumped build number: ${currentBuild} → ${newBuild} (version stays ${newVersion}).`
    : `Bumped iOS release: ${iosConf.version === newVersion && info && !info.versionReleased ? `${newVersion} (${currentBuild} → ${newBuild})` : `${newVersion} (${newBuild})`}.`,
);

if (raiseMinNativeBuild) {
  const floors = JSON.parse(readFileSync(minNativeBuildPath, "utf8"));
  floors.ios = Number(newBuild);
  writeFileSync(minNativeBuildPath, `${JSON.stringify(floors, null, 2)}\n`);
  console.log(
    `Raised the iOS native build floor to ${newBuild} — after this merges and prod ` +
      "deploys, older native builds will be prompted to update from the App Store.",
  );
}

execFileSync("bun", [path.join(appDir, "scripts", "sync-ios-bundle-metadata.mjs")], {
  stdio: "inherit",
});

if (process.env.GITHUB_OUTPUT) {
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    `version=${newVersion}\nbuild=${newBuild}\n`,
  );
}
