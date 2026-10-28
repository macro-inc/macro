// Verify this branch bumped the iOS release numbers relative to the base
// branch. Fail-fast guard used by the `iOS Native Check` merge gate and by
// `iOS App Store Release` before spending ~40 minutes building: a PR with
// native iOS changes must ship a new App Store release, which requires
//   - a marketing version no lower than the base's (it only moves once the
//     committed one has shipped — a re-release keeps it),
//   - a higher build number, and
//   - the iOS floor in min-native-build.json either raised to that build
//     number, so the next prod web deploy locks out older native builds, or
//     left exactly as the base has it (`just ios-bump --no-min`: a release
//     older installs don't need). Run `just ios-bump` to do all three; see
//     scripts/ios-bump-version.mjs. Whether the version is above the latest
//     App Store release is checked by `ios-app-store.mjs status`, which can
//     ask App Store Connect.
//
// The base ref defaults to origin/main; override with BASE_REF. Requires the
// base ref to be fetched (CI checks out with full history).

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { exit } from "node:process";
import { fileURLToPath } from "node:url";

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baseRef = process.env.BASE_REF || "origin/main";

// Repo-root-relative paths, as `git show <ref>:<path>` requires.
const IOS_CONF = "apps/web/tauri/src-tauri/tauri.ios.conf.json";
const MIN_NATIVE_BUILD = "apps/web/min-native-build.json";

function baseFile(repoPath) {
  try {
    return execFileSync("git", ["-C", appDir, "show", `${baseRef}:${repoPath}`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    return null;
  }
}

const baseConfText = baseFile(IOS_CONF);
if (baseConfText === null) {
  console.error(
    `Could not read ${IOS_CONF} at ${baseRef} — is the base ref fetched?`,
  );
  exit(1);
}
const baseConf = JSON.parse(baseConfText);
const headConf = JSON.parse(
  readFileSync(path.join(appDir, "tauri", "src-tauri", "tauri.ios.conf.json"), "utf8"),
);
const headMin = JSON.parse(readFileSync(path.join(appDir, "min-native-build.json"), "utf8"));
const baseMinText = baseFile(MIN_NATIVE_BUILD);
const baseMinIos = baseMinText === null ? null : JSON.parse(baseMinText).ios;

const baseVersion = baseConf.version;
const headVersion = headConf.version;
const baseBuild = Number(baseConf.bundle?.iOS?.bundleVersion);
const headBuild = Number(headConf.bundle?.iOS?.bundleVersion);

function versionTriple(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version ?? "");
  return match ? match.slice(1).map(Number) : null;
}

const errors = [];

function compareTriples(a, b) {
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

const baseTriple = versionTriple(baseVersion);
const headTriple = versionTriple(headVersion);
if (!headTriple) {
  errors.push(`version ${JSON.stringify(headVersion)} is not "major.minor.patch".`);
} else if (baseTriple && compareTriples(headTriple, baseTriple) < 0) {
  errors.push(
    `version is ${headVersion}, below ${baseRef}'s ${baseVersion} — it must not go backwards.`,
  );
}

if (!Number.isInteger(headBuild)) {
  errors.push(`bundleVersion ${JSON.stringify(headConf.bundle?.iOS?.bundleVersion)} is not an integer.`);
} else if (Number.isInteger(baseBuild) && headBuild <= baseBuild) {
  errors.push(
    `bundleVersion is ${headBuild}, but ${baseRef} is already at ${baseBuild} — it must increase.`,
  );
}

if (headMin.ios !== headBuild && headMin.ios !== baseMinIos) {
  errors.push(
    `min-native-build.json has ios ${headMin.ios}, expected the new build number ` +
      `${headBuild} so older native builds get locked out after the prod deploy` +
      (baseMinIos === null ? "." : ` (or ${baseMinIos}, unchanged from ${baseRef}, for a release older installs don't need).`),
  );
}

if (errors.length > 0) {
  console.error(
    `This PR changes native iOS code but has not bumped the iOS release numbers vs ${baseRef}:`,
  );
  for (const error of errors) {
    console.error(`  - ${error}`);
  }
  console.error(
    "\nRun `just ios-bump` in apps/web and commit the result " +
      "(tauri.ios.conf.json, min-native-build.json, and the synced gen/apple metadata).",
  );
  exit(1);
}

console.log(
  `iOS release numbers are bumped: ${baseVersion} (${baseBuild}) → ${headVersion} (${headBuild}), ` +
    `iOS floor ${headMin.ios}${headMin.ios === headBuild ? "" : " (unchanged: older installs are not locked out)"}.`,
);
