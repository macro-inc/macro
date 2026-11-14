// Where a run leaves what the coverage report is built from.

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

export function runPaths(run: Run) {
  const dir = `${RESULTS.replace(/\/$/, '')}/${run}`;
  return {
    dir,
    /** Playwright's JSON report. */
    playwright: `${dir}/playwright.json`,
    /** One file per test result: what the test did. */
    evidence: `${dir}/evidence`,
  };
}

/** Where `report.ts` writes. */
export const REPORT = `${RESULTS.replace(/\/$/, '')}/report`;
