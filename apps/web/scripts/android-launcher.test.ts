import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const web = dirname(dirname(fileURLToPath(import.meta.url)));

describe('Android launcher arguments', () => {
  let root: string;
  let app: string;
  let caller: string;
  let env: NodeJS.ProcessEnv;

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'macro android ')));
    app = join(root, 'app');
    caller = join(root, 'caller');
    for (const path of [
      'app/scripts',
      'app/tauri/src-tauri',
      'caller/config files',
      'bin',
      'sdk/platforms/android-36',
      'ndk/toolchains/llvm',
    ]) {
      mkdirSync(join(root, path), { recursive: true });
    }
    copyFileSync(join(web, 'justfile'), join(app, 'justfile'));
    copyFileSync(
      join(web, 'scripts/android.sh'),
      join(app, 'scripts/android.sh')
    );
    writeFileSync(join(caller, 'config files/google-services.json'), '{}');
    for (const command of ['bun', 'cargo']) {
      writeFileSync(
        join(root, 'bin', command),
        `#!/bin/sh
if [ "$1" = scripts/android-release.ts ]; then
  printf '%s\\0' "$@" > "$CAPTURE_SIGNING"
  exit "\${SIGNING_EXIT_CODE:-0}"
fi
printf '%s\\0' "$@" > "$CAPTURE_${command.toUpperCase()}"
`,
        { mode: 0o700 }
      );
    }
    env = {
      ...process.env,
      // CI's Nix startup file resets PATH, hiding the fixture's bun/cargo stubs.
      BASH_ENV: '',
      PATH: `${join(root, 'bin')}:${process.env.PATH}`,
      ANDROID_HOME: join(root, 'sdk'),
      NDK_HOME: join(root, 'ndk'),
      CAPTURE_BUN: join(root, 'bun.args'),
      CAPTURE_CARGO: join(root, 'cargo.args'),
      CAPTURE_SIGNING: join(root, 'signing.args'),
      SIGNING_EXIT_CODE: '0',
    };
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const captured = (path: string) =>
    readFileSync(path, 'utf8').split('\0').slice(0, -1);

  it.each([
    ['build', [], true],
    ['build', ['--debug'], false],
    ['build', ['-d'], false],
    ['build', ['--help'], false],
    ['build', ['--', '--debug'], true],
    ['dev', [], false],
  ])('prepares signing for %s %j: %s', (action, args, needsSigning) => {
    const result = spawnSync(
      'bash',
      [join(app, 'scripts/android.sh'), action, ...args],
      { cwd: caller, env }
    );
    expect(result.status, result.stderr.toString()).toBe(0);
    if (needsSigning) {
      expect(captured(join(root, 'signing.args'))).toEqual([
        'scripts/android-release.ts',
        'ensure-signing',
        join(process.env.HOME!, '.macro-android-signing'),
        'tauri/src-tauri/gen/android/keystore.properties',
      ]);
    } else {
      expect(() => captured(join(root, 'signing.args'))).toThrow();
    }
  });

  it('does not invoke Cargo when signing setup fails', () => {
    const result = spawnSync(
      'bash',
      [join(app, 'scripts/android.sh'), 'build'],
      { cwd: caller, env: { ...env, SIGNING_EXIT_CODE: '1' } }
    );
    expect(result.status).toBe(1);
    expect(() => captured(join(root, 'cargo.args'))).toThrow();
  });

  for (const action of ['dev', 'build']) {
    it(`fetches pinned config for android-${action} even when local files exist`, () => {
      for (const directory of [
        'firebase/dev',
        'firebase/prod',
        'gen/android/app',
      ]) {
        const path = join(app, 'tauri/src-tauri', directory);
        mkdirSync(path, { recursive: true });
        writeFileSync(join(path, 'google-services.json'), '{}');
      }
      const result = spawnSync(
        'bash',
        [join(app, 'scripts/android.sh'), action],
        {
          cwd: caller,
          env,
        }
      );
      expect(result.status, result.stderr.toString()).toBe(0);
      expect(captured(join(root, 'bun.args'))).toEqual([
        'scripts/android-firebase.ts',
        action,
        '--doppler',
        'tauri/src-tauri/gen/android/app/google-services.json',
      ]);
    });

    it(`forwards spaced paths and literal shell characters through android-${action}`, () => {
      const config = join(caller, 'config files/google-services.json');
      const extra = '{"label":"two words; $HOME"}';
      const result = spawnSync(
        'just',
        [
          '--justfile',
          join(app, 'justfile'),
          `android-${action}`,
          '--firebase-config',
          config,
          '--config',
          extra,
        ],
        { cwd: caller, env }
      );
      expect(result.stderr.toString()).not.toContain(
        'Firebase configuration file not found'
      );
      expect(result.status, result.stderr.toString()).toBe(0);
      expect(captured(join(root, 'bun.args'))).toEqual([
        'scripts/android-firebase.ts',
        action,
        config,
        'tauri/src-tauri/gen/android/app/google-services.json',
      ]);
      const args = captured(join(root, 'cargo.args'));
      expect(args.slice(0, 3)).toEqual(['tauri', 'android', action]);
      expect(args).toContain(extra);
    });
  }

  it('does not invoke Cargo when Firebase setup fails', () => {
    writeFileSync(join(root, 'bin', 'bun'), '#!/bin/sh\nexit 1\n', {
      mode: 0o700,
    });
    const result = spawnSync(
      'bash',
      [join(app, 'scripts/android.sh'), 'build'],
      {
        cwd: caller,
        env,
      }
    );
    expect(result.status).toBe(1);
    expect(() => captured(join(root, 'cargo.args'))).toThrow();
  });

  it('resolves a relative Firebase path against the direct caller directory', () => {
    const result = spawnSync(
      'bash',
      [
        join(app, 'scripts/android.sh'),
        'build',
        '--firebase-config',
        'config files/google-services.json',
      ],
      { cwd: caller, env }
    );
    expect(result.status, result.stderr.toString()).toBe(0);
    expect(captured(join(root, 'bun.args'))[2]).toBe(
      join(caller, 'config files/google-services.json')
    );
  });

  it('rejects missing Firebase input before invoking build tools', () => {
    for (const args of [
      ['--firebase-config'],
      ['--firebase-config', 'missing.json'],
    ]) {
      const result = spawnSync(
        'bash',
        [join(app, 'scripts/android.sh'), 'build', ...args],
        { cwd: caller, env }
      );
      expect(result.status).toBe(1);
      expect(result.stderr.toString()).toContain(
        'Firebase configuration file not found'
      );
    }
  });
});
