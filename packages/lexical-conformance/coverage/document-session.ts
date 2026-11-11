import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { desktopIncludesSession } from './desktop-contract';
import { root } from './evidence';

function run(command: string, args: string[]): string {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return result.stdout;
}
const metadata: {
  packages: { name: string; manifest_path: string }[];
  workspace_members: string[];
} = JSON.parse(
  run('cargo', ['metadata', '--no-deps', '--format-version', '1'])
);
const clients = metadata.packages.filter((pkg) =>
  pkg.manifest_path.startsWith(path.join(root, 'crates/client/'))
);
for (const pkg of clients) {
  const tree = run('cargo', [
    'tree',
    '-p',
    pkg.name,
    '--target',
    'wasm32-unknown-unknown',
    '-e',
    'normal',
    '--prefix',
    'none',
  ]);
  if (tree.split('\n').some((line) => /^workspace-hack v/.test(line)))
    throw new Error(`Client ${pkg.name} depends on workspace-hack`);
}
const sessions = clients.filter((pkg) => pkg.name === 'document_session_wasm');
if (!sessions.length) {
  const message =
    'PENDING: document-session crates/artifacts have not landed; session wasm/size/desktop gates cannot execute yet.';
  console.log(message);
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, message + '\n');
} else {
  run('just', [
    '--justfile',
    path.join(root, 'apps/web/justfile'),
    'build-document-session-wasm',
  ]);
  const artifact = path.join(
    root,
    'apps/web/src/lib/core/document-session/wasm/document_session_wasm_bg.wasm'
  );
  if (!existsSync(artifact))
    throw new Error(
      'Session build must emit the native document-session WASM artifact'
    );
  const size = run('bun', [
    path.join(root, 'apps/web/scripts/document-session-size.ts'),
    artifact,
  ]).trim();
  const desktop = readFileSync(
    path.join(root, 'nix/tauri-desktop.nix'),
    'utf8'
  );
  if (!desktopIncludesSession(desktop))
    throw new Error('Desktop coreWasmPackages omits document_session_wasm');
  console.log(
    `Session wasm size/desktop contract passed: ${size}`
  );
}
