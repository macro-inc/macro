import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const config = fileURLToPath(new URL('../../sgconfig.yml', import.meta.url));

type Finding = {
  file: string;
  range: { start: { line: number; column: number }; end: { line: number } };
  ruleId: string;
  message: string;
};

function command(cwd: string, executable: string, args: string[]): string {
  return execFileSync(executable, args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/** Enforce FE-20 on changed statements, without grandfathering whole files. */
export function checkNewSwitches(cwd: string, base?: string): string[] {
  const root = command(cwd, 'git', ['rev-parse', '--show-toplevel']).trim();
  const git = (...args: string[]) => command(root, 'git', args);
  let comparison: string;
  try {
    comparison = base
      ? git('rev-parse', '--verify', `${base}^{commit}`).trim()
      : git('merge-base', 'HEAD', 'origin/main').trim();
  } catch {
    throw new Error(
      'FE-20 check needs a valid comparison commit. Fetch origin/main or set CHECK_BASE; refusing to skip committed changes.'
    );
  }

  const untracked = new Set(
    git('ls-files', '--others', '--exclude-standard', '-z').split('\0')
  );
  const files = [
    ...new Set([
      ...git(
        'diff',
        '--name-only',
        '--no-renames',
        '--diff-filter=ACMRT',
        '-z',
        comparison
      ).split('\0'),
      ...untracked,
    ]),
  ].filter(
    (file) =>
      /\.(?:ts|tsx|mts|cts)$/.test(file) && existsSync(resolve(root, file))
  );
  if (files.length === 0) return [];

  const findings: Finding[] = JSON.parse(
    command(root, 'bunx', [
      '--yes',
      '@ast-grep/cli@0.44.1',
      'scan',
      '--config',
      config,
      '--filter',
      '^tsx?-no-switch$',
      '--json=compact',
      '--',
      ...files,
    ])
  );
  const violations: string[] = [];
  for (const finding of findings) {
    const file = relative(root, resolve(root, finding.file));
    const start = finding.range.start.line + 1;
    const end = finding.range.end.line + 1;
    const diff = command(root, 'git', [
      'diff',
      '--no-ext-diff',
      '--no-color',
      '--unified=0',
      comparison,
      '--',
      file,
    ]);
    const changed = [
      ...diff.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm),
    ].some((hunk) => {
      const first = Number(hunk[1]);
      const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
      // A deletion changes the boundary after `first`; only flag it when
      // that boundary lies inside a surviving switch statement.
      if (count === 0) return first >= start && first < end;
      return first <= end && first + count - 1 >= start;
    });
    if (untracked.has(file) || changed) {
      violations.push(
        `${file}:${start}:${finding.range.start.column + 1} [${finding.ruleId}] ${finding.message}`
      );
    }
  }
  return violations;
}

if (import.meta.main) {
  try {
    const violations = checkNewSwitches(process.cwd(), process.env.CHECK_BASE);
    if (violations.length) {
      console.error(violations.join('\n'));
      process.exitCode = 1;
    } else {
      console.log('FE-20: no new or modified TypeScript switch statements.');
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
