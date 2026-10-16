import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

const script = fileURLToPath(new URL('./ios-native-env.sh', import.meta.url));

test.each([
  ['aarch64-apple-ios', 'library'],
  ['aarch64-apple-ios-sim', 'library'],
  ['aarch64-apple-ios', 'missing'],
  ['aarch64-apple-ios', 'directory'],
])('resolve %s with %s and no compgen builtin', (target, fixture) => {
  const directory = mkdtempSync(join(tmpdir(), 'ios-native-env-'));
  try {
    const developer = join(directory, 'Xcode.app', 'Contents', 'Developer');
    const libdir = join(directory, 'rust libraries', target);
    mkdirSync(join(developer, 'Platforms', 'iPhoneOS.platform'), {
      recursive: true,
    });
    mkdirSync(libdir, { recursive: true });
    if (fixture === 'library') writeFileSync(join(libdir, 'libstd-test.rlib'), '');
    if (fixture === 'directory') mkdirSync(join(libdir, 'libstd-test.rlib'));

    const result = spawnSync(
      'bash',
      [
        '-euo',
        'pipefail',
        '-c',
        `
# Reproduce Nix's Bash, which has no programmable-completion builtins.
enable -n compgen 2>/dev/null || true
function /usr/bin/xcrun() { printf '/fixture/%s\\n' "$4"; }
cargo() { :; }
rustc() {
  [[ "$*" == "--print target-libdir --target $TEST_TARGET" ]]
  printf '%s\\n' "$TEST_LIBDIR"
}
source "$1"
ios_resolve_toolchain "$TEST_TARGET"
printf 'resolved %s\\n' "$ios_rust_target"
`,
        'ios-native-env-test',
        script,
      ],
      {
        env: {
          ...process.env,
          BASH_ENV: undefined,
          ENV: undefined,
          DEVELOPER_DIR: developer,
          RUSTC: 'rustc',
          TEST_LIBDIR: libdir,
          TEST_TARGET: target,
        },
        encoding: 'utf8',
      }
    );
    if (fixture === 'library') {
      expect(result.stderr).toBe('');
      expect(result.status).toBe(0);
      expect(result.stdout).toBe(`resolved ${target}\n`);
    } else {
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(`missing ${target}: ${libdir}`);
      expect(result.stdout).toBe('');
    }
    expect(result.stderr).not.toContain('compgen: command not found');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
