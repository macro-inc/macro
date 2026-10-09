import { afterEach, expect, test, vi } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const directories: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true });
});

test('publication retries reuse signatures and reject changed package bytes', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'macro-signing-retry-'));
  directories.push(directory);
  const bin = join(directory, 'bin');
  const artifacts = join(directory, 'release-artifacts');
  const published = join(directory, 'published');
  const startup = join(directory, 'shell-startup.sh');
  writeFileSync(startup, 'echo "Inherited shell startup executed" >&2\nexit 97\n');
  vi.stubEnv('BASH_ENV', startup);
  vi.stubEnv('ENV', startup);
  for (const path of [bin, artifacts, published]) mkdirSync(path);
  const names = ['Macro-test.app.tar.gz', 'Macro-test.AppImage'];
  const signature = Buffer.from('previously published signature').toString('base64');
  for (const name of names) {
    writeFileSync(join(artifacts, name), 'immutable package');
    writeFileSync(join(published, name), 'immutable package');
    writeFileSync(join(published, `${name}.sig`), signature);
  }
  for (const target of ['darwin-aarch64', 'linux-x86_64']) {
    writeFileSync(join(artifacts, `${target}.release.json`), JSON.stringify({ publicKey: Buffer.from('test key').toString('base64') }));
  }
  const executable = (name: string, body: string) => writeFileSync(join(bin, name), `#!/usr/bin/env bash\nset -euo pipefail\n${body}\n`, { mode: 0o755 });
  executable('curl', `printf '%s' '{"TAURI_SIGNING_PRIVATE_KEY":"test-only-unused-key"}'`);
  executable('gh', `
if [ "$1 $2" = 'release view' ]; then
  printf '%s' '{"assets":[{"name":"Macro-test.app.tar.gz.sig"},{"name":"Macro-test.AppImage.sig"}]}'
elif [ "$1 $2" = 'release download' ]; then
  patterns=()
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --pattern) patterns+=("$2"); shift 2 ;;
      --dir) destination="$2"; shift 2 ;;
      *) shift ;;
    esac
  done
  for name in "\${patterns[@]}"; do cp "$TEST_PUBLISHED/$name" "$destination/$name"; done
else
  exit 1
fi`);
  // Verification is covered cryptographically by the Rust fixture tests.
  // This mock forbids signing again, the source of the publication retry bug.
  executable('nix', `
case "$*" in
  *'cargo-tauri signer sign'*) echo 'Unexpected re-signing' >&2; exit 1 ;;
  *'minisign -Vm'*) echo verified >> "$TEST_VERIFICATIONS" ;;
  *) exit 1 ;;
esac`);
  const script = resolve(dirname(fileURLToPath(import.meta.url)), '../../../tooling/xtask/crates/xtask_workflows/src/workflows/scripts/sign_desktop_updates.sh');
  const run = () => new Promise<{ code: number | null; stderr: string }>((resolve, reject) => {
    const child = spawn('bash', [script], {
      cwd: directory,
      // CI's Nix BASH_ENV resets PATH, bypassing the command fixtures.
      env: { ...process.env, BASH_ENV: undefined, ENV: undefined, PATH: `${bin}:${process.env.PATH}`, DOPPLER_TOKEN: 'test-only', RELEASE_TAG: 'v1.0.0', RELEASE_REPOSITORY: 'test/test', TEST_PUBLISHED: published, TEST_VERIFICATIONS: join(directory, 'verified') },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stderr }));
  });
  expect(await run()).toEqual({ code: 0, stderr: '' });
  for (const name of names) expect(readFileSync(join(artifacts, `${name}.sig`), 'utf8')).toBe(signature);
  expect(readFileSync(join(directory, 'verified'), 'utf8').trim().split('\n')).toHaveLength(2);
  writeFileSync(join(artifacts, names[0]), 'changed package');
  expect((await run()).code).not.toBe(0);
});
