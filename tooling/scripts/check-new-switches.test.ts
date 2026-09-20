import { afterEach, describe, expect, test } from 'bun:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkNewSwitches } from './check-new-switches';

const script = fileURLToPath(
  new URL('./check-new-switches.ts', import.meta.url)
);
const fixtures: string[] = [];
const legacy = `export function label(value: string) {
  switch (value) {
    case 'a': return 'A';
    default: return '?';
  }
}
`;

function fixture() {
  const cwd = mkdtempSync(join(tmpdir(), 'macro-fe20-'));
  fixtures.push(cwd);
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();
  const write = (file: string, source: string) => {
    mkdirSync(dirname(join(cwd, file)), { recursive: true });
    writeFileSync(join(cwd, file), source);
  };
  git('init', '-q', '--initial-branch=main');
  git('config', 'user.email', 'fe20-test@macro.local');
  git('config', 'user.name', 'FE-20 Test');
  git('config', 'commit.gpgsign', 'false');
  git('config', 'core.hooksPath', '/dev/null');
  write('legacy.ts', legacy);
  git('add', '.');
  git('commit', '-qm', 'initial fixture');
  return { cwd, git, write, base: git('rev-parse', 'HEAD') };
}

afterEach(() => {
  for (const cwd of fixtures.splice(0))
    rmSync(cwd, { recursive: true, force: true });
});

describe('FE-20 enforcement through real Git diffs and ast-grep parsing', () => {
  test('allows untouched legacy statements when surrounding code changes', () => {
    const { cwd, write, base } = fixture();
    write(
      'legacy.ts',
      `// Added documentation\n${legacy}\nexport const other = 1;\n`
    );
    expect(checkNewSwitches(cwd, base)).toEqual([]);
  });

  test('blocks a committed switch on a feature branch', () => {
    const { cwd, write, git, base } = fixture();
    write('new.ts', legacy);
    git('add', '.');
    git('commit', '-qm', 'new switch');
    expect(checkNewSwitches(cwd, base)).toEqual([
      expect.stringContaining('new.ts:2:3 [ts-no-switch] FE-20'),
    ]);
  });

  test('blocks a staged switch added to a file that already contains one', () => {
    const { cwd, write, git, base } = fixture();
    write('legacy.ts', `${legacy}\nswitch ('new') { default: break; }\n`);
    git('add', '.');
    expect(checkNewSwitches(cwd, base)).toHaveLength(1);
  });

  test('blocks modifications and deletions inside legacy statements', () => {
    const { cwd, write, base } = fixture();
    write('legacy.ts', legacy.replace("return 'A'", "return 'Changed'"));
    expect(checkNewSwitches(cwd, base)).toHaveLength(1);
    write('legacy.ts', legacy.replace("    case 'a': return 'A';\n", ''));
    expect(checkNewSwitches(cwd, base)).toHaveLength(1);
  });

  test.each(['ts', 'tsx', 'mts', 'cts'])(
    'blocks untracked multiline switches in .%s',
    (extension) => {
      const { cwd, write, base } = fixture();
      write(`new file.${extension}`, "switch\n ('a') {\n default: break;\n}\n");
      expect(checkNewSwitches(cwd, base)).toHaveLength(1);
    }
  );

  test('allows match expressions, strings, comments, and generated or vendor code', () => {
    const { cwd, write, base } = fixture();
    write(
      'new.ts',
      `
      import { match } from 'ts-pattern';
      // switch (x) { default: break; }
      const text = 'switch (x) { default: break; }';
      const result = match('a' as 'a' | 'b').with('a', () => 1).with('b', () => 2).exhaustive();
    `
    );
    write('generated/client.ts', legacy);
    write('vendor/library.ts', legacy);
    write('schema.gen.ts', legacy);
    expect(checkNewSwitches(cwd, base)).toEqual([]);
  });

  test('allows removing the last switch', () => {
    const { cwd, write, base } = fixture();
    write('legacy.ts', 'export const label = (value: string) => value;\n');
    expect(checkNewSwitches(cwd, base)).toEqual([]);
  });

  test('fails explicitly when the comparison base is unavailable', () => {
    const { cwd } = fixture();
    expect(() => checkNewSwitches(cwd)).toThrow('set CHECK_BASE');
    expect(() => checkNewSwitches(cwd, 'missing-ref')).toThrow(
      'set CHECK_BASE'
    );
  });

  test('the shared local/CI command exits nonzero with a useful diagnostic', () => {
    const { cwd, write, base } = fixture();
    write(
      'new.tsx',
      `export function View() {\n switch ('a') { default: return <div />; }\n}\n`
    );
    const result = spawnSync(process.execPath, [script], {
      cwd,
      env: { ...process.env, CHECK_BASE: base },
      encoding: 'utf8',
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('new.tsx:2:2 [tsx-no-switch] FE-20');
  });
});
