// Where a run leaves what the coverage report is built from.

import { existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** `apps/web`. */
export const WEB = fileURLToPath(new URL('../../../', import.meta.url));

/** The repository. */
export const REPOSITORY = fileURLToPath(
  new URL('../../../../../', import.meta.url)
);

const RESULTS =
  process.env.EMAIL_E2E_COVERAGE_DIR ??
  fileURLToPath(new URL('../ledger-results/', import.meta.url));

/**
 * The gating run on the per-test stack, the gating run on a local stack (the
 * full-stack tier), or the run of the tests kept for known bugs.
 */
export type Run = 'gating' | 'full-stack' | 'known-bugs';

/** The runs whose passing tests count as coverage. */
export const GATING_RUNS = ['gating', 'full-stack'] satisfies Run[];

export function currentRun(): Run {
  if (process.env.EMAIL_E2E_KNOWN_BUGS) return 'known-bugs';
  return process.env.EMAIL_E2E_STACK_PROXY_URL ? 'full-stack' : 'gating';
}

/**
 * The part of the suite this process runs, as Playwright's `--shard` takes it
 * ("2/3"), when CI splits a run over machines. Each part writes a report of
 * its own, and their directories are laid over each other before the
 * coverage report reads them.
 */
const SHARD = process.env.EMAIL_E2E_SHARD?.split('/')[0];

export function runPaths(run: Run) {
  const dir = `${RESULTS.replace(/\/$/, '')}/${run}`;
  return {
    dir,
    /** Playwright's JSON report of this process. */
    playwright: `${dir}/playwright${SHARD ? `-${SHARD}` : ''}.json`,
    /** One file per test result: what the test did. */
    evidence: `${dir}/evidence`,
  };
}

/** Every Playwright report a run left: one, or one per shard. */
export function runReports(run: Run): string[] {
  const { dir } = runPaths(run);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => /^playwright(-\d+)?\.json$/.test(name))
    .sort()
    .map((name) => `${dir}/${name}`);
}

/** Where `report.ts` writes. */
export const REPORT = `${RESULTS.replace(/\/$/, '')}/report`;
