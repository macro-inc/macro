import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageDir = dirname(dirname(fileURLToPath(import.meta.url)));
const packageJson = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'));

function parseBuildNumber(name, fallback) {
  const value = process.env[name];
  if (value == null || value === '') return fallback;
  if (!/^\d+$/.test(value)) {
    throw new Error(`${name} must be an unsigned integer, got ${JSON.stringify(value)}`);
  }
  return Number(value);
}

function gitSha() {
  try {
    return execSync('git rev-parse --short HEAD', {
      cwd: packageDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

const manifest = {
  schemaVersion: 2,
  bundleBuild: parseBuildNumber('BUNDLE_BUILD_NUMBER', Date.now()),
  minNativeBuild: parseBuildNumber('MIN_NATIVE_BUILD', 0),
  gitSha: gitSha(),
  appVersion: packageJson.version,
};

const outPath = join(packageDir, 'dist', 'bundle-manifest.json');
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(manifest, null, 2)}\n`);
