// Reads a run: Playwright's JSON report and what each test recorded, and
// keeps the evidence that counts: a result that passed, of a test that is
// neither skipped nor kept for a known bug.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { type Run, runPaths } from './paths';
import type { Evidence } from './record';

type JsonResult = {
  status: string;
  retry: number;
  duration: number;
  error?: { message?: string };
};
type JsonSpec = {
  id: string;
  title: string;
  file: string;
  line: number;
  tags: string[];
  tests: { status: string; results: JsonResult[] }[];
};
type JsonSuite = { title: string; specs?: JsonSpec[]; suites?: JsonSuite[] };

export type Test = {
  id: string;
  title: string;
  file: string;
  line: number;
  knownBug: boolean;
  /** Playwright's verdict over the retries. */
  status: 'expected' | 'unexpected' | 'flaky' | 'skipped';
  results: JsonResult[];
};

export type RunResult = {
  /** Whether the run left a report at all. */
  found: boolean;
  tests: Test[];
  /** The evidence of results that passed, in tests that count. */
  evidence: Evidence[];
  /** Evidence files that belong to no counted result, with the reason. */
  dropped: { file: string; why: string }[];
};

export function readRun(run: Run): RunResult {
  const paths = runPaths(run);
  if (!existsSync(paths.playwright)) {
    return { found: false, tests: [], evidence: [], dropped: [] };
  }
  const report = JSON.parse(readFileSync(paths.playwright, 'utf8')) as {
    suites: JsonSuite[];
  };
  const tests = new Map<string, Test>();
  const visit = (suite: JsonSuite, titles: string[]) => {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests) {
        tests.set(spec.id, {
          id: spec.id,
          title: [...titles, spec.title].join(' › '),
          file: spec.file,
          line: spec.line,
          knownBug: spec.tags.some(
            (tag) => tag.replace('@', '') === 'known-bug'
          ),
          status: test.status as Test['status'],
          results: test.results,
        });
      }
    }
    for (const inner of suite.suites ?? []) {
      visit(inner, [...titles, inner.title]);
    }
  };
  // The outermost suites are the files.
  for (const file of report.suites) visit(file, []);

  const evidence: Evidence[] = [];
  const dropped: RunResult['dropped'] = [];
  const names = existsSync(paths.evidence) ? readdirSync(paths.evidence) : [];
  for (const name of names.sort()) {
    const one = JSON.parse(
      readFileSync(`${paths.evidence}/${name}`, 'utf8')
    ) as Evidence;
    const test = tests.get(one.testId);
    const result = test?.results.find((each) => each.retry === one.retry);
    const why = !test
      ? 'not in the report'
      : run === 'gating' && test.knownBug
        ? 'a test for a known bug'
        : run === 'gating' && result?.status !== 'passed'
          ? `the result ${result?.status ?? 'is missing'}`
          : undefined;
    if (why) dropped.push({ file: name, why });
    else evidence.push(one);
  }
  return { found: true, tests: [...tests.values()], evidence, dropped };
}
