/**
 * The handover checker. It runs the real coordinator, engine runtime and cache
 * host over a simulated browser, explores every scenario in `scenarios.ts` to
 * its bound, and requires the violations found to be exactly the known ones
 * (`known-violations.ts`). See `README.md` for what it covers.
 */
import { writeFileSync } from 'node:fs';
import { afterAll, describe, expect, it, vi } from 'vitest';
import {
  explains,
  explore,
  minimal,
  runScript,
  type ViolationKey,
  violationKey,
} from './explore';
import { KNOWN_VIOLATIONS } from './known-violations';
import { SCENARIOS, SCRIPTS } from './scenarios';

vi.mock('../app-build', async () => {
  const { currentBuildTime } = await import('./world');
  return {
    get APP_BUILD_TIME() {
      return currentBuildTime();
    },
  };
});

const DEEP = process.env.HANDOVER_CHECKER_DEEP === '1';
const report: unknown[] = [];
const everything: ViolationKey[] = [];

/** The found violations no known one accounts for. */
function unknown(found: ViolationKey[]): string[] {
  everything.push(...found);
  return found
    .filter(
      (violation) =>
        !KNOWN_VIOLATIONS.some((known) => explains(known, violation))
    )
    .map(violationKey);
}

afterAll(() => {
  const path = process.env.HANDOVER_CHECKER_REPORT;
  if (path) writeFileSync(path, JSON.stringify(report, null, 1));
});

describe('handover checker', () => {
  for (const { scenario, bound } of SCENARIOS.filter(
    (entry) => DEEP || !entry.deep
  )) {
    it(
      `finds nothing new: ${scenario.name}`,
      async () => {
        const started = Date.now();
        const result = await explore(scenario, bound);
        report.push({
          ms: Date.now() - started,
          ...result,
        });
        // Where it can afford to, the deep run checks that merging states
        // hides nothing.
        if (DEEP && bound.maxFaults + bound.maxDelays === 1) {
          const all = await explore(scenario, { ...bound, prune: false });
          report.push({ unpruned: scenario.name, runs: all.runs });
          expect(all.truncated, 'the unpruned run was complete').toBe(false);
          expect(all.cutShort, 'unpruned runs that hit a step cap').toBe(0);
          expect(all.findings.map(violationKey).sort()).toEqual(
            result.findings.map(violationKey).sort()
          );
        }
        expect(unknown(result.findings)).toEqual([]);
        expect(result.truncated, 'the bound was explored in full').toBe(false);
        expect(result.cutShort, 'runs that hit a step cap').toBe(0);
      },
      10 * 60 * 60_000
    );
  }

  for (const { name, pages, script } of SCRIPTS) {
    it(`finds nothing new: ${name}`, async () => {
      const result = await runScript(pages, script);
      report.push({
        scenario: name,
        findings: result.violations,
        steps: result.steps,
      });
      expect(unknown(result.violations)).toEqual([]);
      expect(result.cutShort, 'the run hit a step cap').toBe(false);
    }, 60_000);
  }

  it('still finds every known violation', () => {
    const found = minimal(everything).map(violationKey);
    const stale = KNOWN_VIOLATIONS.filter((known) => DEEP || !known.deep)
      .map(violationKey)
      .filter((known) => !found.includes(known));
    expect(stale).toEqual([]);
  });
});
