/**
 * Ratchet for oxlint's typescript/no-floating-promises (FE-13). The rule needs
 * type information, so it runs oxlint with `--type-aware` over src/ and
 * compares per-file violation counts against floating-promises-baseline.json.
 * A file may not gain violations, and a file that loses some must have its
 * baseline lowered, so the total can only go down.
 *
 *   bun scripts/check-floating-promises.ts            verify the baseline
 *   bun scripts/check-floating-promises.ts --update   rewrite it after fixes
 */

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const OXLINT_PACKAGE = 'oxlint@1.73.0';
const TSGOLINT_PACKAGE = 'oxlint-tsgolint@7.0.2004';
const RULE_CODE = 'typescript(no-floating-promises)';
const BASELINE_FILE = 'floating-promises-baseline.json';

type Diagnostic = {
  code: string;
  message: string;
  filename: string;
  labels: { span: { line: number; column: number } }[];
};

export type ViolationCounts = Record<string, number>;

export type BaselineDrift = {
  file: string;
  baseline: number;
  current: number;
};

export function countViolations(diagnostics: Diagnostic[]): ViolationCounts {
  const counts: ViolationCounts = {};
  for (const diagnostic of diagnostics) {
    if (diagnostic.code !== RULE_CODE) continue;
    counts[diagnostic.filename] = (counts[diagnostic.filename] ?? 0) + 1;
  }
  return counts;
}

export function compareToBaseline(
  current: ViolationCounts,
  baseline: ViolationCounts
): { increased: BaselineDrift[]; decreased: BaselineDrift[] } {
  const increased: BaselineDrift[] = [];
  const decreased: BaselineDrift[] = [];
  const files = new Set([...Object.keys(current), ...Object.keys(baseline)]);
  for (const file of [...files].sort()) {
    const drift = {
      file,
      baseline: baseline[file] ?? 0,
      current: current[file] ?? 0,
    };
    if (drift.current > drift.baseline) increased.push(drift);
    if (drift.current < drift.baseline) decreased.push(drift);
  }
  return { increased, decreased };
}

export function formatBaseline(counts: ViolationCounts): string {
  const sorted = Object.fromEntries(
    Object.entries(counts).sort(([a], [b]) => a.localeCompare(b))
  );
  return `${JSON.stringify(sorted, null, 2)}\n`;
}

async function lintSource(webRoot: string): Promise<Diagnostic[]> {
  const lint = Bun.spawn(
    [
      'npx',
      '--yes',
      '-p',
      OXLINT_PACKAGE,
      '-p',
      TSGOLINT_PACKAGE,
      '-c',
      'oxlint --type-aware --format json src',
    ],
    { cwd: webRoot, stdout: 'pipe', stderr: 'inherit' }
  );
  const [output, exitCode] = await Promise.all([
    new Response(lint.stdout).text(),
    lint.exited,
  ]);
  // oxlint exits 1 when it reports errors; anything else means it did not run.
  if (exitCode !== 0 && exitCode !== 1) {
    throw new Error(`oxlint --type-aware exited with ${exitCode}`);
  }
  return (JSON.parse(output) as { diagnostics: Diagnostic[] }).diagnostics;
}

function describe(drift: BaselineDrift): string {
  return `${drift.file}: ${drift.current} now, ${drift.baseline} in ${BASELINE_FILE}`;
}

async function main(): Promise<void> {
  const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const baselinePath = resolve(webRoot, BASELINE_FILE);
  const diagnostics = await lintSource(webRoot);
  const current = countViolations(diagnostics);

  if (process.argv.includes('--update')) {
    await Bun.write(baselinePath, formatBaseline(current));
    return;
  }

  const baseline = (await Bun.file(baselinePath).json()) as ViolationCounts;
  const { increased, decreased } = compareToBaseline(current, baseline);
  const total = Object.values(current).reduce((sum, n) => sum + n, 0);

  for (const drift of increased) {
    console.error(`new floating promise: ${describe(drift)}`);
    for (const diagnostic of diagnostics) {
      if (diagnostic.code !== RULE_CODE) continue;
      if (diagnostic.filename !== drift.file) continue;
      const { line, column } = diagnostic.labels[0].span;
      console.error(`  ${drift.file}:${line}:${column} ${diagnostic.message}`);
    }
  }
  if (increased.length > 0) {
    console.error(
      'Await the promise, return it, handle its rejection with .catch(), or ' +
        'mark an intentionally unawaited call with `void` (FE-13).'
    );
  }
  for (const drift of decreased) {
    console.error(`fixed floating promises: ${describe(drift)}`);
  }
  if (decreased.length > 0) {
    console.error(
      'Lower the baseline so they cannot come back: (cd apps/web && bun scripts/check-floating-promises.ts --update)'
    );
  }
  if (increased.length > 0 || decreased.length > 0) process.exit(1);
  console.log(`no-floating-promises: ${total} violations, none new`);
}

if (import.meta.main) {
  await main();
}
