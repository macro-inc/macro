import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const plugin = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repository = resolve(plugin, '../../../..');
const metadata = Bun.spawn(
  [
    'cargo',
    'metadata',
    '--manifest-path',
    resolve(plugin, '../Cargo.toml'),
    '--format-version',
    '1',
    '--locked',
    '--filter-platform',
    'aarch64-linux-android',
  ],
  { cwd: repository, stdout: 'pipe', stderr: 'inherit' }
);
const output = await new Response(metadata.stdout).text();
if ((await metadata.exited) !== 0)
  throw new Error('Cannot resolve the pinned Tauri Android source');
const json: unknown = JSON.parse(output);
if (
  typeof json !== 'object' ||
  json === null ||
  !('packages' in json) ||
  !Array.isArray(json.packages)
) {
  throw new Error('Invalid Cargo metadata');
}
let tauriAndroidPath: string | undefined;
for (const candidate of json.packages) {
  const entry: unknown = candidate;
  if (
    typeof entry === 'object' &&
    entry !== null &&
    'name' in entry &&
    entry.name === 'tauri' &&
    'manifest_path' in entry &&
    typeof entry.manifest_path === 'string'
  ) {
    tauriAndroidPath = resolve(dirname(entry.manifest_path), 'mobile/android');
    break;
  }
}
if (!tauriAndroidPath)
  throw new Error('Pinned Tauri crate is missing from Cargo metadata');
const tasks = process.argv.slice(2);
const gradle = Bun.spawn(
  [
    resolve(plugin, '../src-tauri/gen/android/gradlew'),
    '-p',
    resolve(plugin, 'android'),
    '--max-workers=4',
    ...(tasks.length
      ? tasks
      : [':testDebugUnitTest', ':assembleDebugAndroidTest']),
  ],
  {
    cwd: repository,
    env: { ...process.env, TAURI_ANDROID_PROJECT_PATH: tauriAndroidPath },
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  }
);
process.exit(await gradle.exited);
