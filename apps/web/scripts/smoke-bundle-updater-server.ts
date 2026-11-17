import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';

/*
 * Manual smoke server for the native OTA bundle updater.
 *
 * Intended use:
 * 1. Build the embedded app baseline; bundle-stamp numbers it from HEAD's
 *    commit time (dist/bundle-manifest.json):
 *      MIN_NATIVE_BUILD=0 bun run build
 * 2. Start this server from apps/web. Fixtures are numbered relative to that
 *    baseline: "older" is a commit 10s before it, "101" one second after it
 *    and "102" two seconds after it:
 *      just bundle-smoke-server older --host 0.0.0.0 --port 3001
 * 3. Build/run the native app from the same dist with:
 *      MACRO_BUNDLE_UPDATE_BASE_URL=http://<MAC-LAN-IP>:3001
 *    If testing on a physical iPhone with a plain HTTP LAN URL, iOS ATS may
 *    block the request unless you temporarily allow local networking in the
 *    app's Info.plist. Do not commit that ATS override; remove it after smoke
 *    testing or use an HTTPS tunnel instead.
 * 4. Switch scenarios while the app is running:
 *      curl http://<MAC-LAN-IP>:3001/__scenario/update-101
 *      curl http://<MAC-LAN-IP>:3001/__scenario/revoke-101
 *      curl http://<MAC-LAN-IP>:3001/__scenario/incompatible-102
 *
 * This script creates fixture archives under .bundle-smoke/ from the current
 * dist output. Commit this script and the just recipe, but do not
 * commit generated .bundle-smoke artifacts or local IP/build-setting values.
 */

type Scenario =
  | 'older'
  | 'no-update'
  | 'update-101'
  | 'revoke-101'
  | 'incompatible-102';

/** Commit-time offsets from the baseline, in seconds, per fixture. */
const OLDER_OFFSET = -10;
const UPDATE_OFFSET = 1;
const INCOMPATIBLE_OFFSET = 2;
/** A well-formed commit id; fixtures name no real commit. */
const FIXTURE_SHA = '5'.repeat(40);

type BundleArtifact = {
  build: number;
  minNativeBuild: number;
  zipPath: string;
  fileName: string;
  checksum: string;
};

const scenarios = new Set<Scenario>([
  'older',
  'no-update',
  'update-101',
  'revoke-101',
  'incompatible-102',
]);

const appRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const distDir = join(appRoot, 'packages', 'app', 'dist');
const packageJsonPath = join(appRoot, 'packages', 'app', 'package.json');
const workDir = join(appRoot, '.bundle-smoke');
const artifactsDir = join(workDir, 'artifacts');

function parseArgs() {
  const args = process.argv.slice(2);
  let host = '0.0.0.0';
  let port = 3001;
  let scenario: Scenario = 'older';
  let prepareOnly = false;
  let help = false;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      help = true;
    } else if (arg === '--prepare-only') {
      prepareOnly = true;
    } else if (arg === '--host') {
      host = args[++i] ?? host;
    } else if (arg === '--port') {
      port = Number(args[++i] ?? port);
    } else if (arg === '--scenario') {
      scenario = parseScenario(args[++i]);
    } else if (!arg.startsWith('-')) {
      scenario = parseScenario(arg);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`--port must be a positive integer, got ${port}`);
  }

  return { host, port, scenario, prepareOnly, help };
}

function parseScenario(value: string | undefined): Scenario {
  if (value != null && scenarios.has(value as Scenario)) return value as Scenario;
  throw new Error(
    `Scenario must be one of: ${[...scenarios].join(', ')}. Got ${JSON.stringify(value)}`
  );
}

function printHelp() {
  console.log(`Usage:
  bun scripts/smoke-bundle-updater-server.ts [scenario] [--host 0.0.0.0] [--port 3001]

Scenarios:
  older             Advertise a commit 10s older than dist. The baseline app should get 204.
  no-update         Always return 204.
  update-101        Advertise a commit 1s newer than dist.
  revoke-101        Return action: "clear" when the app runs the update-101 bundle.
  incompatible-102  Return native_update_required for a commit 2s newer, with minNativeBuild 999999.

Runtime controls:
  GET /__scenario
  POST /__scenario/<scenario>
  GET /__scenario/<scenario>

Native build example:
  MACRO_BUNDLE_UPDATE_BASE_URL=http://<LAN-IP>:3001 MIN_NATIVE_BUILD=0 just ios-build
`);
}

function appVersion(): string {
  return JSON.parse(readFileSync(packageJsonPath, 'utf8')).version;
}

function assertDistExists() {
  if (!existsSync(join(distDir, 'index.html'))) {
    throw new Error(
      `Missing ${join(distDir, 'index.html')}. Build the app first, for example:\n` +
        `  MIN_NATIVE_BUILD=0 just ios-build`
    );
  }
}

/** Commit time of the stamped dist bundle, in seconds. */
function baselineCommitTime(): number {
  const manifest = JSON.parse(readFileSync(join(distDir, 'bundle-manifest.json'), 'utf8'));
  if (!Number.isSafeInteger(manifest.commitTime)) {
    throw new Error('dist/bundle-manifest.json has no commitTime; rebuild with bun run build');
  }
  return manifest.commitTime;
}

/** Fixtures are stamped like real bundles: bundleBuild = commitTime * 1000. */
function writeManifest(bundleDir: string, commitTime: number, minNativeBuild: number) {
  writeFileSync(
    join(bundleDir, 'bundle-manifest.json'),
    `${JSON.stringify(
      {
        schemaVersion: 2,
        bundleBuild: commitTime * 1000,
        commitTime,
        gitSha: FIXTURE_SHA,
        minNativeBuild,
        appVersion: appVersion(),
      },
      null,
      2
    )}\n`
  );
}

function zipDir(sourceDir: string, zipPath: string) {
  rmSync(zipPath, { force: true });
  const result = spawnSync('zip', ['-qr', zipPath, '.'], {
    cwd: sourceDir,
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    throw new Error(`zip failed for ${sourceDir}`);
  }
}

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function buildArtifact(commitTime: number, minNativeBuild: number): BundleArtifact {
  const build = commitTime * 1000;
  const bundleDir = join(workDir, `bundle-${build}`);
  const fileName = `bundle-${build}.zip`;
  const zipPath = join(artifactsDir, fileName);

  rmSync(bundleDir, { recursive: true, force: true });
  cpSync(distDir, bundleDir, { recursive: true });
  writeManifest(bundleDir, commitTime, minNativeBuild);
  zipDir(bundleDir, zipPath);

  return {
    build,
    minNativeBuild,
    zipPath,
    fileName,
    checksum: sha256(zipPath),
  };
}

function prepareArtifacts() {
  assertDistExists();
  rmSync(artifactsDir, { recursive: true, force: true });
  mkdirSync(artifactsDir, { recursive: true });
  const baseline = baselineCommitTime();
  const artifacts = new Map<number, BundleArtifact>();
  for (const [offset, minNativeBuild] of [
    [OLDER_OFFSET, 0],
    [UPDATE_OFFSET, 0],
    [INCOMPATIBLE_OFFSET, 999999],
  ] as const) {
    const artifact = buildArtifact(baseline + offset, minNativeBuild);
    artifacts.set(offset, artifact);
    console.log(
      `[bundle-smoke] prepared ${artifact.fileName} checksum=${artifact.checksum}`
    );
  }
  return artifacts;
}

function localUrls(port: number): string[] {
  const urls = [`http://localhost:${port}`];
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === 'IPv4' && !entry.internal) {
        urls.push(`http://${entry.address}:${port}`);
      }
    }
  }
  return urls;
}

function updateResponse(artifact: BundleArtifact, origin: string) {
  return Response.json({
    action: 'update',
    bundleBuild: artifact.build,
    minNativeBuild: artifact.minNativeBuild,
    notes: null,
    url: `${origin}/artifacts/${artifact.fileName}`,
    checksum: artifact.checksum,
  });
}

function nativeUpdateRequiredResponse(artifact: BundleArtifact) {
  return Response.json({
    action: 'native_update_required',
    bundleBuild: artifact.build,
    minNativeBuild: artifact.minNativeBuild,
  });
}

function noContent() {
  return new Response(null, { status: 204 });
}

function notFound() {
  return new Response('not found\n', { status: 404 });
}

function badRequest(message: string) {
  return new Response(`${message}\n`, { status: 400 });
}

function parseQueryBuildNumber(url: URL, name: string): number | null {
  const rawValue = url.searchParams.get(name);
  if (rawValue == null || rawValue.trim() === '') return null;

  const value = Number(rawValue);
  return Number.isFinite(value) && Number.isInteger(value) && value >= 0
    ? value
    : null;
}

const { host, port, scenario: initialScenario, prepareOnly, help } = parseArgs();
if (help) {
  printHelp();
  process.exit(0);
}

const artifacts = prepareArtifacts();
if (prepareOnly) process.exit(0);

let scenario = initialScenario;

const server = Bun.serve({
  hostname: host,
  port,
  fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === '/__scenario') {
      return Response.json({ scenario, scenarios: [...scenarios] });
    }

    if (url.pathname.startsWith('/__scenario/')) {
      scenario = parseScenario(url.pathname.split('/').at(-1));
      console.log(`[bundle-smoke] scenario=${scenario}`);
      return Response.json({ scenario });
    }

    if (url.pathname.startsWith('/artifacts/')) {
      const fileName = url.pathname.split('/').at(-1);
      const artifact = [...artifacts.values()].find((a) => a.fileName === fileName);
      if (!artifact) return notFound();
      return new Response(Bun.file(artifact.zipPath), {
        headers: { 'content-type': 'application/zip' },
      });
    }

    const match = url.pathname.match(/^\/update\/bundle\/([^/]+)\/([^/]+)$/);
    if (!match) return notFound();

    const [, target, arch] = match;
    const currentBundleBuild = parseQueryBuildNumber(url, 'current_bundle_build');
    const nativeBuild = parseQueryBuildNumber(url, 'native_build');
    if (currentBundleBuild == null || nativeBuild == null) {
      return badRequest('current_bundle_build and native_build must be non-negative integers');
    }
    console.log(
      `[bundle-smoke] ${target}/${arch} current=${currentBundleBuild} native=${nativeBuild} scenario=${scenario}`
    );

    if (scenario === 'no-update') return noContent();
    if (scenario === 'revoke-101') {
      if (currentBundleBuild === artifacts.get(UPDATE_OFFSET)?.build) {
        return Response.json({ action: 'clear', reason: 'bundle_revoked' });
      }
      return noContent();
    }

    const artifact =
      scenario === 'older'
        ? artifacts.get(OLDER_OFFSET)
        : scenario === 'update-101'
          ? artifacts.get(UPDATE_OFFSET)
          : artifacts.get(INCOMPATIBLE_OFFSET);

    if (!artifact) return noContent();
    if (artifact.build <= currentBundleBuild) return noContent();
    if (artifact.minNativeBuild > nativeBuild) {
      return nativeUpdateRequiredResponse(artifact);
    }
    return updateResponse(artifact, url.origin);
  },
});

console.log(`[bundle-smoke] scenario=${scenario}`);
console.log(`[bundle-smoke] listening on ${server.hostname}:${server.port}`);
for (const url of localUrls(server.port)) {
  console.log(`[bundle-smoke] ${url}`);
}
