// App Store Connect automation for the iOS app — one executable, several
// commands sharing auth, config defaults, and app lookup:
//
//   wait-build   Poll until an uploaded build finishes processing and its
//                export compliance is resolved (i.e. TestFlight-ready).
//                ITSAppUsesNonExemptEncryption=false in src-tauri/Info.ios.plist
//                answers the encryption questionnaire during processing
//                (exempt encryption only); if App Store Connect still
//                reports the question as unanswered (shown as "Missing
//                Compliance" in TestFlight) this fails so the plist regression
//                is caught rather than papered over.
//
//   submit       Attach the processed build to an App Store version (created
//                on demand with releaseType AFTER_APPROVAL), fill in empty
//                "What's New" texts, and submit it for App Review. Safe to
//                re-run: an already-submitted version is a no-op success.
//
//   status       Report the App Store state of a version. With --require-live
//                it exits non-zero unless exactly this version+build is live
//                on the App Store, built from --native-tree (or this checkout's
//                native code) — the gate the `iOS Native Check` job runs on
//                PRs with native iOS changes.
//
// Auth (same values as ios-release.sh):
//   APPLE_API_KEY       App Store Connect API Key ID
//   APPLE_API_ISSUER    Issuer ID
//   APPLE_API_KEY_P8    contents of the AuthKey .p8, or
//   APPLE_API_KEY_PATH  path to AuthKey_<KEYID>.p8 (defaults to
//                       ~/.appstoreconnect/private_keys/AuthKey_<KEYID>.p8)
// Doppler's names (ios-release/prd: APPLE_API_KEY_ID, APPLE_API_ISSUER,
// APPLE_API_PRIVATE_KEY) are accepted as fallbacks, so locally
//   doppler run --project ios-release --config prd -- bun scripts/ios-app-store.mjs …
// works as-is. CI fetches the same secrets and writes the .p8 to the default path.
//
// --bundle-id / --version / --build default to the identifier in
// tauri/src-tauri/tauri.conf.json and the version / bundleVersion in
// tauri/src-tauri/tauri.ios.conf.json, so CI can run the commands bare.
//
// Usage:
//   bun scripts/ios-app-store.mjs wait-build [--timeout-minutes 30]
//   bun scripts/ios-app-store.mjs submit [--whats-new "release notes"]
//   bun scripts/ios-app-store.mjs status [--require-live] [--require-unused-build]
//   bun scripts/ios-app-store.mjs release-info
//   bun scripts/ios-app-store.mjs withdraw --pr <number>
//
// release-info prints JSON for ios-bump-version.mjs: the highest build number
// App Store Connect has seen (any version, TestFlight included), whether the
// committed marketing version has ever been released, and the highest version
// string — so hand-made releases can't make the committed numbers fall behind
// and the marketing version only moves once it has actually shipped.
//
// withdraw removes PR <number>'s in-flight submission from review (the build's
// stamp names the PR) — the drift workflow runs it when native code is pushed
// after a release, so a stale build can never go live. submit later takes
// that version record over (renaming it if the version string moved).
//
// Provenance: version + build number alone don't identify a PR's native code
// (two PRs bumped from the same base get the same numbers), so wait-build
// stamps each uploaded build with the hash of the native code it was built
// from (nativeTreeHash(): the filtered `git ls-tree` of apps/web/tauri, or
// --native-tree) in its
// TestFlight "What to Test" text. status's collision check (with
// --require-unused-build, before the release builds) fails when a build at
// or above ours exists with a different stamp — another PR or a hand release — and
// reports `uploaded=true` (GITHUB_OUTPUT) when it is our own upload, so a
// release retry skips the build. The live check (--require-live) requires the
// live build's stamp to match this checkout's native tree — in the merge gate
// that checkout is the PR's merge result, so native code that landed on main
// after the release also fails it (the shipped build lacks it).

import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { exit } from "node:process";
import { fileURLToPath } from "node:url";

const API_BASE = "https://api.appstoreconnect.apple.com";
const POLL_INTERVAL_MS = 30_000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// appVersionState values that mean "users can download this version from the
// App Store". READY_FOR_SALE is the deprecated appStoreState spelling.
const LIVE_STATES = new Set(["READY_FOR_DISTRIBUTION", "READY_FOR_SALE"]);

// States past the point of submission — re-running `submit` on these is a
// no-op, not an error.
const SUBMITTED_STATES = new Set([
  "WAITING_FOR_REVIEW",
  "IN_REVIEW",
  "ACCEPTED",
  "PENDING_APPLE_RELEASE",
  "PENDING_DEVELOPER_RELEASE",
  "PROCESSING_FOR_DISTRIBUTION",
  "PROCESSING_FOR_APP_STORE",
  ...LIVE_STATES,
]);

// Past review: Apple approved the version and nothing can withdraw it any
// more — with release type "after approval" it is minutes from live.
const APPROVED_STATES = new Set([
  "ACCEPTED",
  "PENDING_APPLE_RELEASE",
  "PENDING_DEVELOPER_RELEASE",
  "PROCESSING_FOR_DISTRIBUTION",
  "PROCESSING_FOR_APP_STORE",
]);

// Versions that shipped and were superseded or pulled — never in flight.
const RETIRED_STATES = new Set([
  "REPLACED_WITH_NEW_VERSION",
  "REMOVED_FROM_SALE",
  "DEVELOPER_REMOVED_FROM_SALE",
  "NOT_APPLICABLE",
]);

// Review submission states that can still be withdrawn.
const WITHDRAWABLE_SUBMISSION_STATES = new Set([
  "READY_FOR_REVIEW",
  "WAITING_FOR_REVIEW",
  "IN_REVIEW",
  "UNRESOLVED_ISSUES",
]);

const BOOLEAN_FLAGS = new Set(["require-live", "require-unused-build"]);

/// "The native code": every tracked blob under this directory except what
/// never reaches the iOS binary — anything Android-only by Tauri's naming
/// convention (a path component `android`, `android_*`, `android.*` or
/// `*.android.*`), the desktop updater manifest, editor config — plus the
/// version of the client cache wasm package, which the team bumps when a
/// cache change must ship (the app compiles the cache crates natively). Must
/// match `native_tree_hash` in
/// tooling/xtask/.../workflows/scripts/ios_native_tree.sh and the iOS Native
/// Check's change detection.
const NATIVE_TREE_PATH = "apps/web/tauri";
const CACHE_WASM_MANIFEST = "crates/client/cache-wasm/Cargo.toml";
const NATIVE_TREE_EXCLUDE = /(^|\/)android([_.\/]|$)|\.android\.|^desktop-release\.json$|^\.helix\//;
const STAMP_RE = /native tree ([0-9a-f]{40})/;
const STAMP_PR_RE = /for PR #(\d+)/;

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (!flag?.startsWith("--")) {
      console.error(`Malformed arguments near ${JSON.stringify(flag)}`);
      exit(2);
    }
    const name = flag.slice(2);
    if (BOOLEAN_FLAGS.has(name)) {
      args[name] = true;
      continue;
    }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) {
      console.error(`Flag ${flag} requires a value`);
      exit(2);
    }
    args[name] = value;
    i += 1;
  }
  return args;
}

const [command, ...rest] = process.argv.slice(2);
if (!["wait-build", "submit", "status", "release-info", "withdraw"].includes(command ?? "")) {
  console.error(
    "Usage: ios-app-store.mjs <wait-build|submit|status|release-info|withdraw> [flags]",
  );
  exit(2);
}
const args = parseArgs(rest);

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
function readJson(relative) {
  return JSON.parse(readFileSync(path.join(appDir, relative), "utf8"));
}

const bundleId =
  args["bundle-id"] ?? readJson("tauri/src-tauri/tauri.conf.json").identifier;

/// Hash of this checkout's native tree (--native-tree overrides, e.g. the
/// watcher, whose checkout is main), or null outside a git checkout.
function nativeTreeHash() {
  if (args["native-tree"]) {
    return args["native-tree"];
  }
  try {
    const git = (gitArgs, input) =>
      execFileSync("git", gitArgs, {
        cwd: appDir,
        encoding: "utf8",
        input,
        stdio: ["pipe", "pipe", "ignore"],
      });
    // --full-tree: ls-tree otherwise narrows its output to the cwd (apps/web).
    const listing = git(["ls-tree", "-r", "--full-tree", `HEAD:${NATIVE_TREE_PATH}`])
      .split("\n")
      .filter((line) => line && !NATIVE_TREE_EXCLUDE.test(line.split("\t")[1]))
      .map((line) => `${line}\n`)
      .join("");
    let cacheWasmVersion = "none";
    try {
      cacheWasmVersion =
        git(["show", `HEAD:${CACHE_WASM_MANIFEST}`]).match(/^version *= *"([^"]*)"/m)?.[1] ?? "none";
    } catch {
      // The package did not exist at this commit.
    }
    return git(["hash-object", "--stdin"], `${listing}cache-wasm-version ${cacheWasmVersion}\n`).trim();
  } catch {
    return null;
  }
}

function setGitHubOutput(name, value) {
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
  }
}
const iosConf = readJson("tauri/src-tauri/tauri.ios.conf.json");
const version = args.version ?? iosConf.version;
const build = args.build ?? iosConf.bundle?.iOS?.bundleVersion;
if (!bundleId || !version || !build) {
  console.error(
    "Could not resolve --bundle-id / --version / --build from flags or tauri config.",
  );
  exit(2);
}

// Unset CI env vars surface as empty strings, so || (not ??) throughout.
const keyId = process.env.APPLE_API_KEY || process.env.APPLE_API_KEY_ID;
const issuerId = process.env.APPLE_API_ISSUER;
if (!keyId || !issuerId) {
  console.error("APPLE_API_KEY (or APPLE_API_KEY_ID) and APPLE_API_ISSUER must be set.");
  exit(2);
}

const pem =
  process.env.APPLE_API_KEY_P8 ||
  process.env.APPLE_API_PRIVATE_KEY ||
  readFileSync(
    process.env.APPLE_API_KEY_PATH ||
      path.join(os.homedir(), ".appstoreconnect", "private_keys", `AuthKey_${keyId}.p8`),
    "utf8",
  );
const privateKey = await importPrivateKey(pem);

async function importPrivateKey(pemText) {
  const base64 = pemText
    .replace(/-----(?:BEGIN|END) PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");
  const der = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey(
    "pkcs8",
    der,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
}

function base64url(bytes) {
  return Buffer.from(bytes).toString("base64url");
}

// App Store Connect JWTs must be short-lived (max 20 minutes); mint a fresh
// one per request instead of tracking expiry.
async function makeToken() {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "ES256", kid: keyId, typ: "JWT" };
  const payload = { iss: issuerId, iat: now, exp: now + 600, aud: "appstoreconnect-v1" };
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  // WebCrypto ECDSA signatures are already in the raw r||s form JOSE requires.
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    privateKey,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${base64url(new Uint8Array(signature))}`;
}

const RETRY_DELAYS_MS = [5_000, 15_000, 30_000, 60_000];

/// One App Store Connect call. Network errors, 429 and 5xx are retried with
/// backoff: a single hiccup must not kill a run that has already uploaded a
/// build (that would leave the build unstamped and the number burnt). Other
/// non-2xx responses are fatal; `onError` gets a chance to explain first.
async function api(pathname, { method = "GET", body, onError } = {}) {
  let response;
  for (let attempt = 0; ; attempt += 1) {
    try {
      response = await fetch(`${API_BASE}${pathname}`, {
        method,
        headers: {
          Authorization: `Bearer ${await makeToken()}`,
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (error) {
      response = { ok: false, status: 0, text: async () => String(error) };
    }
    const transient = response.status === 0 || response.status === 429 || response.status >= 500;
    if (!transient || attempt >= RETRY_DELAYS_MS.length) break;
    const delay = RETRY_DELAYS_MS[attempt];
    console.warn(
      `${method} ${pathname} → ${response.status || "network error"}: ${await response.text()}; ` +
        `retrying in ${delay / 1000}s (${attempt + 1}/${RETRY_DELAYS_MS.length}).`,
    );
    await sleep(delay);
  }
  if (!response.ok) {
    const text = await response.text();
    console.error(`${method} ${pathname} → ${response.status}: ${text}`);
    if (onError) {
      await onError(response.status);
    }
    exit(1);
  }
  return response.status === 204 ? null : response.json();
}

const apps = await api(`/v1/apps?filter[bundleId]=${encodeURIComponent(bundleId)}`);
const app = apps.data[0];
if (!app) {
  console.error(`No App Store Connect app found for bundle id ${bundleId}.`);
  exit(1);
}
const testflightUrl = `https://appstoreconnect.apple.com/apps/${app.id}/testflight/ios`;
const distributionUrl = `https://appstoreconnect.apple.com/apps/${app.id}/distribution`;

/// The uploaded build record for this version+build, or null if App Store
/// Connect hasn't registered it yet.
async function findBuild() {
  const builds = await api(
    `/v1/builds?filter[app]=${app.id}` +
      `&filter[version]=${encodeURIComponent(build)}` +
      `&filter[preReleaseVersion.version]=${encodeURIComponent(version)}` +
      `&sort=-uploadedDate&limit=1`,
  );
  return builds.data[0] ?? null;
}

/// The highest build number uploaded for the app across all marketing
/// versions, as { number, version }, or null when nothing was ever uploaded.
/// Build numbers are compared numerically; non-integer ones are ignored.
async function highestUploadedBuild() {
  let pathname =
    `/v1/builds?filter[app]=${app.id}&include=preReleaseVersion` +
    "&fields[builds]=version,preReleaseVersion&fields[preReleaseVersions]=version" +
    "&sort=-uploadedDate&limit=200";
  let highest = null;
  while (pathname) {
    const page = await api(pathname);
    const preReleaseVersions = new Map(
      (page.included ?? [])
        .filter((record) => record.type === "preReleaseVersions")
        .map((record) => [record.id, record.attributes.version]),
    );
    for (const record of page.data) {
      if (!/^\d+$/.test(record.attributes.version)) continue;
      const number = Number(record.attributes.version);
      if (highest && number <= highest.number) continue;
      const preReleaseId = record.relationships?.preReleaseVersion?.data?.id;
      highest = {
        id: record.id,
        number,
        version: preReleaseVersions.get(preReleaseId) ?? "unknown",
      };
    }
    const next = page.links?.next;
    pathname = next ? next.replace(API_BASE, "") : null;
  }
  return highest;
}

/// The stamp on an uploaded build (its TestFlight "What to Test" text) as
/// { tree, pr }, or null for builds uploaded outside the release flow.
async function buildStamp(buildId) {
  const localizations = await api(`/v1/builds/${buildId}/betaBuildLocalizations?limit=10`);
  for (const localization of localizations.data) {
    const text = localization.attributes.whatsNew ?? "";
    const match = STAMP_RE.exec(text);
    if (match) {
      return { tree: match[1], pr: STAMP_PR_RE.exec(text)?.[1] ?? null };
    }
  }
  return null;
}

/// The PR number this run releases for (the stamp carries it, so later runs
/// can tell their own in-flight submission from another PR's), or null.
const releasePr = process.env.IOS_RELEASE_PR || null;

/// Record which native tree a processed build was built from, in its en-US
/// TestFlight "What to Test" text (readable back through the API).
async function stampBuild(buildRecord) {
  const tree = nativeTreeHash();
  if (!tree) {
    console.warn(
      "WARNING: not in a git checkout and no --native-tree given; the build is not " +
        "stamped with its native tree, so the merge gate will not accept it.",
    );
    return;
  }
  const pr = releasePr ? ` for PR #${releasePr}` : "";
  const whatsNew = `Built by ios-release.sh${pr} from native tree ${tree}.`;
  const localizations = await api(
    `/v1/builds/${buildRecord.id}/betaBuildLocalizations?limit=10`,
  );
  const existing = localizations.data.find(
    (localization) => localization.attributes.locale === "en-US",
  );
  if (existing) {
    await api(`/v1/betaBuildLocalizations/${existing.id}`, {
      method: "PATCH",
      body: {
        data: { type: "betaBuildLocalizations", id: existing.id, attributes: { whatsNew } },
      },
    });
  } else {
    await api("/v1/betaBuildLocalizations", {
      method: "POST",
      body: {
        data: {
          type: "betaBuildLocalizations",
          attributes: { locale: "en-US", whatsNew },
          relationships: { build: { data: { type: "builds", id: buildRecord.id } } },
        },
      },
    });
  }
  console.log(`Stamped build ${build} with native tree ${tree}.`);
}

/// Fail when a build at or above ours exists that is not our own upload: the
/// floor `min-native-build.json` derives from our number assumes it is the
/// newest native code, and the gate must never accept another PR's build
/// that happens to share our version + number. Our own earlier upload (same
/// version, same stamp) is a retry: report uploaded=true so the release
/// workflow skips the build and goes straight to submit.
async function requireUnusedBuild() {
  const rebump = `Re-bump past it and commit:
  cd apps/web && doppler run --project ios-release --config prd -- just ios-bump
${testflightUrl}`;
  // App Store Connect won't accept a version string at or below the latest
  // release, and the bump only moves the version once the committed one has
  // shipped — so a shipped version here means the PR is behind the store.
  const released = await highestReleasedVersion();
  if (compareVersions(version, released) <= 0) {
    console.error(`Marketing version ${version} is not above the latest App Store release ${released}. ${rebump}`);
    exit(1);
  }
  console.log(`Marketing version ${version} is above the latest App Store release (${released}).`);
  const highest = await highestUploadedBuild();
  if (!highest) {
    console.log("No builds uploaded yet; build number is free.");
    setGitHubOutput("uploaded", "false");
    return;
  }
  if (highest.number > Number(build)) {
    console.error(`Build ${build} is below the highest build App Store Connect has seen: \
build ${highest.number} was uploaded for version ${highest.version}
(a manual release whose number was never committed, or another native PR). ${rebump}`);
    exit(1);
  }
  if (highest.number === Number(build)) {
    const stamp = (await buildStamp(highest.id))?.tree ?? null;
    const ours = nativeTreeHash();
    if (highest.version === version && ours && stamp === ours) {
      console.log(
        `Build ${build} (${version}) was already uploaded from this native tree — ` +
          "a retry; the build and upload can be skipped.",
      );
      setGitHubOutput("uploaded", "true");
      return;
    }
    console.error(`Build ${build} was already uploaded (for version ${highest.version}) from \
different native code: its stamp is ${stamp ?? "missing (uploaded outside the release flow)"}, \
this checkout's native tree is ${ours ?? "unknown (not a git checkout)"}.
Another native PR or a hand release took this number${
      stamp ? "" : " (or a release run died between uploading and stamping it)"
    }. ${rebump}`);
    exit(1);
  }
  console.log(
    `Build ${build} is above the highest uploaded build ` +
      `(${highest.number}, version ${highest.version}).`,
  );
  setGitHubOutput("uploaded", "false");
}

function versionTriple(versionString) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(versionString ?? "");
  return match ? match.slice(1).map(Number) : null;
}

function compareVersions(a, b) {
  const [ta, tb] = [versionTriple(a) ?? [0, 0, 0], versionTriple(b) ?? [0, 0, 0]];
  for (let i = 0; i < 3; i += 1) {
    if (ta[i] !== tb[i]) return ta[i] - tb[i];
  }
  return 0;
}

/// All IOS appStoreVersions of the app, every page.
async function allAppStoreVersions() {
  const records = [];
  let pathname = `/v1/apps/${app.id}/appStoreVersions?filter[platform]=IOS&limit=200`;
  while (pathname) {
    const page = await api(pathname);
    records.push(...page.data);
    const next = page.links?.next;
    pathname = next ? next.replace(API_BASE, "") : null;
  }
  return records;
}

function isInFlight(record) {
  const state = versionState(record);
  return !LIVE_STATES.has(state) && !RETIRED_STATES.has(state);
}

/// The highest marketing version that has ever shipped (live or retired), or
/// "0.0.0" when none has.
async function highestReleasedVersion() {
  return (await allAppStoreVersions())
    .filter((record) => !isInFlight(record))
    .map((record) => record.attributes.versionString)
    .reduce((best, candidate) => (compareVersions(candidate, best) > 0 ? candidate : best), "0.0.0");
}

/// JSON on stdout for ios-bump-version.mjs (details on stderr).
async function releaseInfo() {
  const highest = await highestUploadedBuild();
  const versions = await allAppStoreVersions();
  const committed = versions.find((record) => record.attributes.versionString === version);
  const state = committed ? versionState(committed) : null;
  const highestVersion = versions
    .map((record) => record.attributes.versionString)
    .reduce((best, candidate) => (compareVersions(candidate, best) > 0 ? candidate : best), "0.0.0");
  const info = {
    highestBuild: highest?.number ?? 0,
    highestBuildVersion: highest?.version ?? null,
    version,
    versionState: state,
    versionReleased: committed ? !isInFlight(committed) : false,
    highestVersion,
  };
  console.error(
    `Highest uploaded build: ${info.highestBuild} (version ${info.highestBuildVersion ?? "n/a"}); ` +
      `version ${version}: ${state ?? "no App Store record"}` +
      `${info.versionReleased ? " (released)" : " (never released)"}; ` +
      `highest App Store version: ${highestVersion}.`,
  );
  console.log(JSON.stringify(info));
}

/// Withdraw an in-flight review submission. Returns true when one was
/// withdrawn, false when there was nothing withdrawable.
async function cancelOpenSubmission() {
  const submissions = await api(
    `/v1/reviewSubmissions?filter[app]=${app.id}&filter[platform]=IOS` +
      `&filter[state]=${[...WITHDRAWABLE_SUBMISSION_STATES].join(",")}&limit=25`,
  );
  const submission = submissions.data[0];
  if (!submission) {
    return false;
  }
  await api(`/v1/reviewSubmissions/${submission.id}`, {
    method: "PATCH",
    body: {
      data: {
        type: "reviewSubmissions",
        id: submission.id,
        attributes: { canceled: true },
      },
    },
  });
  console.log(
    `Withdrew review submission ${submission.id} (was ${submission.attributes.state}).`,
  );
  // Cancellation is asynchronous (CANCELING → COMPLETE); creating a new
  // submission while it is still in progress is rejected.
  const deadline = Date.now() + 5 * 60_000;
  while (true) {
    const current = await api(`/v1/reviewSubmissions/${submission.id}`);
    const state = current.data.attributes.state;
    if (!WITHDRAWABLE_SUBMISSION_STATES.has(state) && state !== "CANCELING") {
      console.log(`Review submission ${submission.id} is now ${state}.`);
      return true;
    }
    if (Date.now() > deadline) {
      console.error(`Review submission ${submission.id} is still ${state} after 5 minutes; try again later.`);
      exit(1);
    }
    await sleep(10_000);
  }
}

/// The in-flight App Store version whose attached build is stamped with the
/// given PR number, as { record, buildNumber }, or null.
async function inFlightVersionForPr(pr) {
  for (const record of await allAppStoreVersions()) {
    if (!isInFlight(record)) continue;
    const attached = await api(`/v1/appStoreVersions/${record.id}/build`);
    if (!attached.data) continue;
    const stamp = await buildStamp(attached.data.id);
    if (stamp?.pr === String(pr)) {
      return { record, buildNumber: attached.data.attributes.version, tree: stamp.tree };
    }
  }
  return null;
}

/// `withdraw --pr N`: remove PR N's in-flight submission from review (native
/// code changed after the release, so that build must never go live).
/// GITHUB_OUTPUT gets withdrawn=true|false and, if the PR's version is past
/// the point of withdrawal — approved by Apple or already shipped —
/// live=<version> (<build>) so the caller can warn loudly.
async function withdraw() {
  const pr = args.pr ?? releasePr;
  if (!pr) {
    console.error("withdraw needs --pr <number> (or IOS_RELEASE_PR).");
    exit(2);
  }
  const mine = await inFlightVersionForPr(pr);
  if (mine) {
    const state = versionState(mine.record);
    console.log(
      `PR #${pr}'s App Store version ${mine.record.attributes.versionString} ` +
        `(build ${mine.buildNumber}) is ${state}.`,
    );
    // --unless-tree <hash>: only withdraw a build that no longer matches the
    // PR's native code (the watcher's drift check for PRs the drift workflow
    // cannot see).
    if (args["unless-tree"] && mine.tree === args["unless-tree"]) {
      console.log(`Its build was built from native tree ${mine.tree}, which is still the PR's; nothing to withdraw.`);
      setGitHubOutput("withdrawn", "false");
      return;
    }
    const withdrawn = await cancelOpenSubmission();
    setGitHubOutput("withdrawn", withdrawn ? "true" : "false");
    if (!withdrawn) {
      if (APPROVED_STATES.has(state)) {
        const live = `${mine.record.attributes.versionString} (${mine.buildNumber})`;
        console.error(
          `PR #${pr}'s version ${live} is ${state}: Apple has approved it and the ` +
            "submission can no longer be withdrawn, so that build is going live.",
        );
        setGitHubOutput("live", live);
      } else {
        console.log("No withdrawable review submission; the version is already editable.");
      }
    }
    return;
  }
  setGitHubOutput("withdrawn", "false");
  // Not in flight: either never submitted, or Apple already released it.
  for (const record of await allAppStoreVersions()) {
    if (!LIVE_STATES.has(versionState(record))) continue;
    const attached = await api(`/v1/appStoreVersions/${record.id}/build`);
    if (!attached.data) continue;
    const stamp = await buildStamp(attached.data.id);
    if (stamp?.pr === String(pr)) {
      const live = `${record.attributes.versionString} (${attached.data.attributes.version})`;
      console.log(`PR #${pr}'s version ${live} is already live on the App Store.`);
      setGitHubOutput("live", live);
      return;
    }
  }
  console.log(`PR #${pr} has no in-flight App Store submission; nothing to withdraw.`);
}

/// The IOS appStoreVersion for this marketing version, or null.
async function findAppStoreVersion() {
  const versions = await api(
    `/v1/apps/${app.id}/appStoreVersions` +
      `?filter[versionString]=${encodeURIComponent(version)}` +
      `&filter[platform]=IOS&limit=1`,
  );
  return versions.data[0] ?? null;
}

function versionState(record) {
  return record.attributes.appVersionState ?? record.attributes.appStoreState;
}

async function waitBuild() {
  const timeoutMinutes = Number(args["timeout-minutes"] ?? 30);
  if (!Number.isFinite(timeoutMinutes) || timeoutMinutes <= 0) {
    console.error(`--timeout-minutes must be a positive number, got ${args["timeout-minutes"]}.`);
    exit(2);
  }
  const deadline = Date.now() + timeoutMinutes * 60_000;
  let buildRecord = null;
  while (true) {
    buildRecord = await findBuild();
    const state = buildRecord?.attributes.processingState;
    if (state && state !== "PROCESSING") {
      break;
    }
    if (Date.now() > deadline) {
      console.error(
        `Timed out after ${timeoutMinutes} minutes waiting for build ${version} (${build}) ` +
          `to finish processing. It usually still completes — check TestFlight later:` +
          `\n${testflightUrl}`,
      );
      exit(1);
    }
    console.log(
      buildRecord
        ? `Build ${version} (${build}) is processing…`
        : `Waiting for build ${version} (${build}) to appear in App Store Connect…`,
    );
    await sleep(POLL_INTERVAL_MS);
  }

  const state = buildRecord.attributes.processingState;
  if (state !== "VALID") {
    console.error(
      `Build ${version} (${build}) finished processing with state ${state}. ` +
        `Check App Store Connect for details:\n${testflightUrl}`,
    );
    exit(1);
  }
  console.log(`Build ${version} (${build}) processed successfully.`);

  // Stamp before anything else can fail: a retry then recognises the upload
  // as ours (uploaded=true) instead of demanding a re-bump.
  await stampBuild(buildRecord);

  const compliance = buildRecord.attributes.usesNonExemptEncryption;
  if (compliance === null || compliance === undefined) {
    console.error(
      "Export compliance is unanswered — ITSAppUsesNonExemptEncryption did not make " +
        'it into the uploaded binary. The build will show as "Missing Compliance" ' +
        `in TestFlight until answered manually in App Store Connect:\n${testflightUrl}`,
    );
    exit(1);
  }
  console.log(`Export compliance resolved (usesNonExemptEncryption=${compliance}).`);
  console.log(`Build is ready for TestFlight: ${testflightUrl}`);
}

/// App Store Connect allows one iOS version in flight (anything that is not
/// live or retired) at a time. Explain which one blocks us instead of
/// surfacing the raw 409 from creating ours.
async function explainVersionInFlight() {
  const inFlight = (await allAppStoreVersions())
    .filter((record) => record.attributes.versionString !== version)
    .filter(isInFlight)
    .map((record) => `${record.attributes.versionString} (${versionState(record)})`);
  if (inFlight.length === 0) {
    console.error(`Could not create App Store version ${version}, and no other version is in flight.
If this followed a retried request the record may already exist: remove and re-add
the ios-update label to pick it up.\n${distributionUrl}`);
    return;
  }
  console.error(`Could not create App Store version ${version}: App Store Connect allows one iOS
version in flight at a time, and these are: ${inFlight.join(", ")}.
Wait for it to ship (another native PR's release) or remove it from review in App
Store Connect, then remove and re-add the ios-update label — the uploaded build
${build} is reused, only the submission is retried.
${distributionUrl}`);
}

async function submit() {
  const buildRecord = await findBuild();
  if (buildRecord?.attributes.processingState !== "VALID") {
    console.error(
      `Build ${version} (${build}) is not processed yet ` +
        `(state ${buildRecord?.attributes.processingState ?? "missing"}). ` +
        "Run `ios-app-store.mjs wait-build` first.",
    );
    exit(1);
  }

  let versionRecord = await findAppStoreVersion();
  if (versionRecord && SUBMITTED_STATES.has(versionState(versionRecord))) {
    const attached = await api(`/v1/appStoreVersions/${versionRecord.id}/build`);
    const attachedNumber = attached.data?.attributes.version ?? null;
    if (attachedNumber === build) {
      console.log(
        `App Store version ${version} (${build}) is already submitted ` +
          `(state ${versionState(versionRecord)}); nothing to do.\n${distributionUrl}`,
      );
      return;
    }
    // Submitted with another build. Ours (same PR, i.e. a stale submission
    // the drift workflow didn't get to) is withdrawn and replaced below;
    // anyone else's is left alone.
    const state = versionState(versionRecord);
    const stamp = attached.data ? await buildStamp(attached.data.id) : null;
    if (!LIVE_STATES.has(state) && releasePr && stamp?.pr === releasePr) {
      console.log(
        `App Store version ${version} is ${state} with this PR's stale build ` +
          `${attachedNumber}; withdrawing it to resubmit with build ${build}.`,
      );
      if (!(await cancelOpenSubmission())) {
        console.error(
          `App Store version ${version} (build ${attachedNumber}) is ${state}: past the point ` +
            "where a submission can be withdrawn, so that build will ship. Bump " +
            "(`just ios-bump`), commit, and re-add the ios-update label to release " +
            `build ${build} as the follow-up.\n${distributionUrl}`,
        );
        exit(1);
      }
    } else if (LIVE_STATES.has(state)) {
      console.error(
        `App Store version ${version} is already live with build ${attachedNumber ?? "none"}` +
          (stamp?.pr ? ` (released for PR #${stamp.pr})` : " (released outside the release flow)") +
          ", so the version string is used up. `just ios-bump` moves the marketing version: " +
          `bump, commit, and re-add the ios-update label.\n${distributionUrl}`,
      );
      exit(1);
    } else {
      console.error(
        `App Store version ${version} is ${state} with build ${attachedNumber ?? "none"}, ` +
          `not this PR's build ${build}` +
          (stamp?.pr ? ` (uploaded for PR #${stamp.pr})` : " (uploaded outside the release flow)") +
          ". App Store Connect allows one version in flight at a time: wait for it to " +
          "ship (then `just ios-bump` moves the version) or remove it from review in App " +
          `Store Connect, then remove and re-add the ios-update label — the uploaded build ${build} ` +
          `is reused.\n${distributionUrl}`,
      );
      exit(1);
    }
  }
  // Take over this PR's own in-flight version from an earlier release whose
  // version string has since moved on (its submission was withdrawn by the
  // drift workflow, or is withdrawn here): App Store Connect allows one
  // editable version, and its version string can be changed until approval.
  if (!versionRecord && releasePr) {
    const mine = await inFlightVersionForPr(releasePr);
    if (mine) {
      const from = mine.record.attributes.versionString;
      console.log(
        `Taking over this PR's in-flight App Store version ${from} ` +
          `(build ${mine.buildNumber}, ${versionState(mine.record)}) as ${version}.`,
      );
      await cancelOpenSubmission();
      versionRecord = (
        await api(`/v1/appStoreVersions/${mine.record.id}`, {
          method: "PATCH",
          body: {
            data: {
              type: "appStoreVersions",
              id: mine.record.id,
              attributes: { versionString: version },
            },
          },
        })
      ).data;
      console.log(`Renamed App Store version ${from} → ${version}.`);
    }
  }
  if (!versionRecord) {
    versionRecord = (
      await api("/v1/appStoreVersions", {
        method: "POST",
        onError: explainVersionInFlight,
        body: {
          data: {
            type: "appStoreVersions",
            attributes: {
              platform: "IOS",
              versionString: version,
              // Release to the App Store as soon as Apple approves — the
              // merge gate (`status --require-live`) waits for exactly that.
              releaseType: "AFTER_APPROVAL",
            },
            relationships: {
              app: { data: { type: "apps", id: app.id } },
            },
          },
        },
      })
    ).data;
    console.log(`Created App Store version ${version}.`);
  } else {
    console.log(
      `Reusing App Store version ${version} (state ${versionState(versionRecord)}).`,
    );
  }

  await api(`/v1/appStoreVersions/${versionRecord.id}/relationships/build`, {
    method: "PATCH",
    body: { data: { type: "builds", id: buildRecord.id } },
  });
  console.log(`Attached build ${build} to version ${version}.`);

  // App Review rejects an update without "What's New" text. New versions
  // inherit the previous version's metadata but start with it empty, so fill
  // it in (an explicit --whats-new always overwrites).
  const whatsNew = args["whats-new"];
  const localizations = await api(
    `/v1/appStoreVersions/${versionRecord.id}/appStoreVersionLocalizations?limit=50`,
  );
  for (const localization of localizations.data) {
    if (!whatsNew && localization.attributes.whatsNew) {
      continue;
    }
    await api(`/v1/appStoreVersionLocalizations/${localization.id}`, {
      method: "PATCH",
      body: {
        data: {
          type: "appStoreVersionLocalizations",
          id: localization.id,
          attributes: {
            whatsNew: whatsNew ?? "Bug fixes and performance improvements.",
          },
        },
      },
    });
    console.log(`Set What's New for ${localization.attributes.locale}.`);
  }

  const openSubmissions = await api(
    `/v1/reviewSubmissions?filter[app]=${app.id}&filter[platform]=IOS` +
      `&filter[state]=READY_FOR_REVIEW,WAITING_FOR_REVIEW,IN_REVIEW,UNRESOLVED_ISSUES&limit=25`,
  );
  // Reuse the open submission that already holds our version (a retry after
  // a lost response, or a version whose review raised issues); otherwise an
  // in-progress submission for something else blocks us, and a draft one
  // (READY_FOR_REVIEW) is reused.
  const holdsOurVersion = async (candidate) => {
    const items = await api(`/v1/reviewSubmissions/${candidate.id}/items?limit=50`);
    return items.data.some(
      (item) => item.relationships?.appStoreVersion?.data?.id === versionRecord.id,
    );
  };
  let submission = null;
  for (const candidate of openSubmissions.data) {
    if (await holdsOurVersion(candidate)) {
      if (candidate.attributes.state !== "READY_FOR_REVIEW") {
        console.log(
          `App Store version ${version} (${build}) is already in a review submission ` +
            `(state ${candidate.attributes.state}); nothing to do.\n${distributionUrl}`,
        );
        return;
      }
      submission = candidate;
      break;
    }
  }
  if (!submission) {
    const blocking = openSubmissions.data.find(
      (candidate) => candidate.attributes.state !== "READY_FOR_REVIEW",
    );
    if (blocking) {
      console.error(
        `A review submission is already in progress (state ${blocking.attributes.state}) ` +
          `and it does not contain version ${version}. Resolve it in App Store Connect first:` +
          `\n${distributionUrl}`,
      );
      exit(1);
    }
    submission = openSubmissions.data[0] ?? null;
  }
  if (!submission) {
    submission = (
      await api("/v1/reviewSubmissions", {
        method: "POST",
        body: {
          data: {
            type: "reviewSubmissions",
            attributes: { platform: "IOS" },
            relationships: {
              app: { data: { type: "apps", id: app.id } },
            },
          },
        },
      })
    ).data;
  }

  const items = await api(
    `/v1/reviewSubmissions/${submission.id}/items?include=appStoreVersion&limit=50`,
  );
  const hasOurVersion = items.data.some(
    (item) => item.relationships?.appStoreVersion?.data?.id === versionRecord.id,
  );
  if (!hasOurVersion) {
    await api("/v1/reviewSubmissionItems", {
      method: "POST",
      body: {
        data: {
          type: "reviewSubmissionItems",
          relationships: {
            reviewSubmission: {
              data: { type: "reviewSubmissions", id: submission.id },
            },
            appStoreVersion: {
              data: { type: "appStoreVersions", id: versionRecord.id },
            },
          },
        },
      },
    });
  }

  await api(`/v1/reviewSubmissions/${submission.id}`, {
    method: "PATCH",
    body: {
      data: {
        type: "reviewSubmissions",
        id: submission.id,
        attributes: { submitted: true },
      },
    },
  });
  console.log(
    `Submitted ${version} (${build}) for App Review. Track it at:\n${distributionUrl}`,
  );
}

async function status() {
  const requireLive = args["require-live"] === true;
  // The collision check is a pre-build check: once our version is live it is
  // the latest release, and later TestFlight uploads (another PR's) are
  // irrelevant — the live version + build + stamp below is the proof.
  if (args["require-unused-build"] === true) {
    await requireUnusedBuild();
  }
  const versionRecord = await findAppStoreVersion();

  const fail = (reason) => {
    console.error(`${reason}

This PR changes native iOS code, so iOS ${version} (build ${build}) must be
live on the App Store before merging (after the merge, the next prod deploy
applies the iOS native build floor committed in min-native-build.json and
prompts older installs to update):
  - Not started yet? Add the \`ios-update\` label to the PR to build, upload,
    and submit it for review.
  - Submitted? Wait for Apple to approve and release it. The \`iOS Release
    Watch\` workflow re-runs this check within half an hour of the release
    (or re-run it yourself).
  - If these tauri changes don't break the native/web contract, add the
    \`skip-ios-update\` label instead.
${distributionUrl}`);
    exit(1);
  };

  if (!versionRecord) {
    console.log(`No App Store version ${version} exists for ${bundleId}.`);
    if (requireLive) {
      fail(`App Store version ${version} has not been created.`);
    }
    return;
  }

  const state = versionState(versionRecord);
  const attachedBuild = await api(`/v1/appStoreVersions/${versionRecord.id}/build`);
  const attachedBuildNumber = attachedBuild.data?.attributes.version ?? null;
  console.log(
    `App Store version ${version}: state ${state}, ` +
      `build ${attachedBuildNumber ?? "not attached"}.`,
  );
  if (!requireLive) {
    return;
  }

  if (RETIRED_STATES.has(state)) {
    fail(
      `App Store version ${version} was live but has been superseded (state ${state}), ` +
        "so the store build may lack this PR's native code. Bump (`just ios-bump` moves " +
        "the version), commit, and re-add the ios-update label to release again.",
    );
  }
  if (!LIVE_STATES.has(state)) {
    fail(`App Store version ${version} is not live yet (state ${state}).`);
  }
  if (attachedBuildNumber !== build) {
    fail(
      `App Store version ${version} is live but was built from build ` +
        `${attachedBuildNumber ?? "unknown"}, not this PR's build ${build}.`,
    );
  }
  const stamp = (await buildStamp(attachedBuild.data.id))?.tree ?? null;
  const ours = nativeTreeHash();
  if (!ours || stamp !== ours) {
    console.error(`App Store version ${version} (${build}) is live, but that build was not built from
the native code this merge would produce: its stamp is ${stamp ?? "missing (uploaded outside the release flow)"},
the merge result's native tree (${NATIVE_TREE_PATH}) is ${ours ?? "unknown"}.
Either native commits were pushed to this PR after the release, native code landed
on main since the release (so the merge would contain code the shipped build lacks),
or another PR / a hand release shipped the same version + build number. Merging main
alone cannot fix it: bump again, commit, and re-add the ios-update label so what will
actually be merged gets released:
  cd apps/web && doppler run --project ios-release --config prd -- just ios-bump
${distributionUrl}`);
    exit(1);
  }
  console.log(`App Store version ${version} (${build}) is live, built from this native tree.`);
}

if (command === "wait-build") {
  await waitBuild();
} else if (command === "submit") {
  await submit();
} else if (command === "release-info") {
  await releaseInfo();
} else if (command === "withdraw") {
  await withdraw();
} else {
  await status();
}
