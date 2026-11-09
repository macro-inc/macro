import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../../..');
execFileSync(
  'bun',
  [
    'packages/collaboration/scripts/generate-native-fields.ts',
    ...(process.argv.includes('--check') ? ['--check'] : []),
  ],
  { cwd: root, stdio: 'inherit' }
);
const outputs = [
  'crates/client/document_session_wasm/src/foreign_host_generated.rs',
  'packages/collaboration/src/session/foreign-host.generated.ts',
];
const before = outputs.map((path) => {
  const absolute = resolve(root, path);
  return existsSync(absolute) ? readFileSync(absolute, 'utf8') : undefined;
});
execFileSync(
  'bunx',
  [
    'bebopc',
    '-df',
    'JSON',
    '-c',
    'crates/client/document_session_wasm/abi/foreign-host.bebop.json',
    'build',
  ],
  {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, COLUMNS: '120', LINES: '40' },
  }
);
if (process.argv.includes('--check')) {
  for (const [i, path] of outputs.entries()) {
    if (readFileSync(resolve(root, path), 'utf8') !== before[i])
      throw new Error(`Stale foreign host ABI: ${path}`);
  }
}
