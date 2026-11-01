// Fails when a native bundle lacks what meetings and dictation need for camera
// and microphone access.
import { readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import {
  MEDIA_ENTITLEMENTS,
  MEDIA_USAGE_KEYS,
  missingStrings,
  missingTrue,
} from './native-permissions';

const repoRoot = resolve(import.meta.dir, '../..');
const tauriDir = resolve(repoRoot, 'apps/web/tauri');
// The macOS release bundles from the Chromium (CEF) config; iOS from src-tauri.
const macosDir = resolve(tauriDir, 'desktop-cef');
const iosPlist = resolve(tauriDir, 'src-tauri/Info.ios.plist');
const read = (path: string) => readFileSync(path, 'utf8');
const show = (path: string) => relative(repoRoot, path);

const macosConfigPath = resolve(macosDir, 'tauri.conf.json');
const macosConfig: {
  bundle?: { macOS?: { infoPlist?: string; entitlements?: string } };
} = JSON.parse(read(macosConfigPath));
const macos = macosConfig.bundle?.macOS;
const problems: string[] = [];

if (!macos?.infoPlist || !macos.entitlements) {
  problems.push(
    `${show(macosConfigPath)} must set bundle.macOS.infoPlist and bundle.macOS.entitlements`
  );
}
const plists = [
  macos?.infoPlist ? resolve(macosDir, macos.infoPlist) : undefined,
  iosPlist,
];
for (const plist of plists) {
  if (!plist) continue;
  for (const key of missingStrings(read(plist), MEDIA_USAGE_KEYS)) {
    problems.push(`${show(plist)} needs a non-empty ${key}`);
  }
}
if (macos?.entitlements) {
  const entitlements = resolve(macosDir, macos.entitlements);
  for (const key of missingTrue(read(entitlements), MEDIA_ENTITLEMENTS)) {
    problems.push(`${show(entitlements)} needs ${key} set to true`);
  }
}

if (problems.length > 0) {
  console.error('Native media permissions are incomplete:');
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
