import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const CONFIG = 'apps/web/tauri/desktop-release.json';
const TARGETS = {
  'darwin-aarch64': '-aarch64-darwin.app.tar.gz',
  'linux-x86_64': '-x86_64-linux.AppImage',
};

/** Map existing four-part desktop tags to sortable SemVer and OTA build IDs. */
export function releaseIdentity(ref) {
  const tag = ref.replace(/^refs\/tags\//, '');
  const calendar = /^v(\d{4})\.(\d{1,2})\.(\d{1,2})\.(\d{1,4})$/.exec(tag);
  let parts;
  if (calendar) {
    const [year, month, day, revision] = calendar.slice(1).map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
      throw new Error(`Invalid release date: ${tag}`);
    }
    parts = [year, month * 100 + day, revision];
  } else {
    const semver = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(tag);
    if (!semver) throw new Error(`Expected vMAJOR.MINOR.PATCH or vYEAR.MONTH.DAY.REVISION: ${tag}`);
    parts = semver.slice(1).map(Number);
  }
  if (parts.some((part) => part < 0 || part > 9999)) throw new Error('Release version components must be between 0 and 9999');
  const [major, minor, patch] = parts;
  const nativeBuild = major * 100_000_000 + minor * 10_000 + patch;
  if (nativeBuild === 0) throw new Error('Release build must be positive');
  return { tag, version: parts.join('.'), nativeBuild };
}

export function isNewer(candidate, current) {
  const parse = (version) => {
    if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`Invalid feed version: ${version}`);
    return version.split('.').map(Number);
  };
  const a = parse(candidate);
  const b = parse(current);
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}

export function createManifest(directory, tag, repository) {
  const identity = releaseIdentity(tag);
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error('Invalid release repository');
  const files = readdirSync(directory);
  const platforms = {};
  for (const [target, suffix] of Object.entries(TARGETS)) {
    const metadata = JSON.parse(readFileSync(join(directory, `${target}.release.json`), 'utf8'));
    if (!metadata.enabled || metadata.version !== identity.version || metadata.nativeBuild !== identity.nativeBuild) {
      throw new Error(`Packaged identity disagrees with release tag for ${target}`);
    }
    const matches = files.filter((name) => name === `Macro-${identity.version}${suffix}`);
    if (matches.length !== 1) throw new Error(`Missing updater artifact for ${target}`);
    const name = matches[0];
    const signature = readFileSync(join(directory, `${name}.sig`), 'utf8').trim();
    if (!signature) throw new Error(`Missing signature for ${target}`);
    platforms[target] = {
      url: `https://github.com/${repository}/releases/download/${identity.tag}/${name}`,
      signature,
    };
  }
  return { version: identity.version, notes: `Macro ${identity.tag}`, platforms };
}

function main([command, ...args]) {
  if (command === 'prepare') {
    const [ref] = args;
    if (!ref) throw new Error('Missing build ref');
    const config = JSON.parse(readFileSync(CONFIG, 'utf8'));
    const release = ref.startsWith('refs/tags/') || /^v\d/.test(ref);
    const commitSeconds = Number(execFileSync('git', ['log', '-1', '--format=%ct'], { encoding: 'utf8' }).trim());
    if (!Number.isSafeInteger(commitSeconds) || commitSeconds <= 0) throw new Error('Missing source commit timestamp');
    if (release) {
      Object.assign(config, releaseIdentity(ref));
      if (!config.publicKey.trim()) throw new Error('The desktop updater public key must be configured before release');
    }
    config.enabled = release;
    config.bundleBuild = commitSeconds * 1000;
    writeFileSync(CONFIG, `${JSON.stringify(config, null, 2)}\n`);
  } else if (command === 'manifest') {
    const [directory, tag, repository] = args;
    writeFileSync(join(directory, 'latest.json'), `${JSON.stringify(createManifest(directory, tag, repository), null, 2)}\n`);
  } else if (command === 'newer') {
    const [candidatePath, currentPath] = args;
    const candidate = JSON.parse(readFileSync(candidatePath, 'utf8'));
    const current = JSON.parse(readFileSync(currentPath, 'utf8'));
    // Exit 2 distinguishes a superseded/equal release from validation/network errors.
    if (!isNewer(candidate.version, current.version)) process.exitCode = 2;
  } else {
    throw new Error('Usage: desktop-release.mjs prepare REF | manifest DIR TAG REPO | newer CANDIDATE CURRENT');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2));
}
