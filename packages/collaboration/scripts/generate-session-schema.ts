import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../../..');
const outputs = [
  'crates/client/document_session_wasm/src/generated.rs',
  'packages/collaboration/src/session/abi.generated.ts',
];
const before = outputs.map((path) => readFileSync(resolve(root, path), 'utf8'));
execFileSync(
  'bunx',
  [
    'bebopc',
    '-df',
    'JSON',
    '-c',
    'crates/client/document_session_wasm/abi/bebop.json',
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
      throw new Error(`Stale session ABI: ${path}`);
  }
}
