import { resolve } from 'node:path';
import { z } from 'zod';
import { EDITOR_BEHAVIOR_MAP } from './editor-behavior-map';

const RESULTS_SCHEMA = z.object({
  testResults: z.array(
    z.object({
      name: z.string(),
      assertionResults: z.array(
        z.object({
          fullName: z.string(),
          status: z.string(),
        })
      ),
    })
  ),
});
type Results = z.infer<typeof RESULTS_SCHEMA>;

// Preserve every occurrence: overlapping evidence remains ambiguous rather
// than silently preferring a later result or disguising a retry as one run.
export function mergeOffReports(reports: unknown[]): Results {
  return {
    testResults: reports.flatMap(
      (report) => RESULTS_SCHEMA.parse(report).testResults
    ),
  };
}

export type BehaviorResult = {
  behavior: string;
  source: string;
  line: number;
  testFile: string;
  status:
    | 'OFF pass; ON pending'
    | 'OFF failed; ON pending'
    | 'OFF unverified; ON pending';
};

export function exactCaseStatus(
  results: unknown,
  testFile: string,
  name: string,
  root: string
): BehaviorResult['status'] {
  return caseStatus(RESULTS_SCHEMA.parse(results), testFile, name, root);
}

function caseStatus(
  parsed: Results,
  testFile: string,
  name: string,
  root: string
): BehaviorResult['status'] {
  const target = resolve(root, testFile);
  const cases = parsed.testResults
    .filter((file) => resolve(root, file.name) === target)
    .flatMap((file) => file.assertionResults)
    .filter((test) => test.fullName === name);
  // Ambiguous names, skips and absent results cannot establish a contract.
  if (cases.length !== 1) return 'OFF unverified; ON pending';
  if (cases[0].status === 'passed') return 'OFF pass; ON pending';
  if (cases[0].status === 'failed') return 'OFF failed; ON pending';
  return 'OFF unverified; ON pending';
}

export async function mappedBehaviors(
  root: string,
  results?: unknown
): Promise<BehaviorResult[]> {
  const rows: BehaviorResult[] = [];
  const names = new Set<string>();
  const parsed =
    results === undefined ? undefined : RESULTS_SCHEMA.parse(results);
  for (const group of EDITOR_BEHAVIOR_MAP) {
    if (!(await Bun.file(resolve(root, group.testFile)).exists()))
      throw new Error(`Missing mapped test: ${group.testFile}`);
    const source = await Bun.file(resolve(root, group.source)).text();
    const anchor = source.indexOf(group.anchor);
    if (anchor < 0 || source.indexOf(group.anchor, anchor + 1) >= 0) {
      throw new Error(
        `Missing or ambiguous source anchor: ${group.source}: ${group.anchor}`
      );
    }
    for (const behavior of group.cases) {
      const key = `${group.testFile}:${behavior}`;
      if (names.has(key)) throw new Error(`Duplicate behavior mapping: ${key}`);
      names.add(key);
      rows.push({
        behavior,
        source: group.source,
        line: source.slice(0, anchor).split('\n').length,
        testFile: group.testFile,
        status:
          parsed === undefined
            ? 'OFF unverified; ON pending'
            : caseStatus(parsed, group.testFile, behavior, root),
      });
    }
  }
  return rows;
}
