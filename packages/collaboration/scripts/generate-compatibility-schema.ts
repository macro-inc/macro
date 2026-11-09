import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../../..');
const outputs = [
  'crates/client/document_session_wasm/src/compatibility_generated.rs',
  'packages/collaboration/src/session/compatibility.generated.ts',
];
const before = outputs.map((file) => {
  const path = resolve(root, file);
  return existsSync(path) ? readFileSync(path, 'utf8') : undefined;
});
execFileSync(
  'bunx',
  [
    'bebopc',
    '-df',
    'JSON',
    '-c',
    'crates/client/document_session_wasm/abi/compatibility.bebop.json',
    'build',
  ],
  {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, COLUMNS: '120', LINES: '40' },
  }
);
if (process.argv.includes('--check')) {
  for (const [index, file] of outputs.entries()) {
    if (readFileSync(resolve(root, file), 'utf8') !== before[index]) {
      throw new Error(`Stale compatibility ABI: ${file}`);
    }
  }
}
