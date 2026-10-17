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

const repoRoot = resolve(import.meta.dir, '../../..');
const tauriDir = resolve(repoRoot, 'apps/web/tauri/src-tauri');
const read = (path: string) => readFileSync(resolve(tauriDir, path), 'utf8');

const macosConfig: {
  bundle?: { macOS?: { infoPlist?: string; entitlements?: string } };
} = JSON.parse(read('tauri.macos.conf.json'));
const macos = macosConfig.bundle?.macOS;
const problems: string[] = [];

if (!macos?.infoPlist || !macos.entitlements) {
  problems.push(
    'tauri.macos.conf.json must set bundle.macOS.infoPlist and bundle.macOS.entitlements'
  );
}
for (const plist of [macos?.infoPlist, 'Info.ios.plist']) {
  if (!plist) continue;
  for (const key of missingStrings(read(plist), MEDIA_USAGE_KEYS)) {
    problems.push(`${plist} needs a non-empty ${key}`);
  }
}
if (macos?.entitlements) {
  for (const key of missingTrue(read(macos.entitlements), MEDIA_ENTITLEMENTS)) {
    problems.push(`${macos.entitlements} needs ${key} set to true`);
  }
}

if (problems.length > 0) {
  console.error(
    `Native media permissions are incomplete in ${relative(repoRoot, tauriDir)}:`
  );
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
