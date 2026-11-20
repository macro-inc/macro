// Checks the suite's ledger against its tests, and with `--report <file>`
// against a run: every test is listed against something channels do, every
// listed thing has a test or a reason it has none,
// and every test did what the ledger says in the run.
//
//   bun tests/channels-e2e/ledger/check.ts [--report <playwright-report.json>]

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

type InventoryRow = {
  item: string;
  behaviour: string;
  tests: string[];
  reason: string;
};
type DefectRow = { test: string; defect: string };
type ReportSpec = {
  title: string;
  ok: boolean;
  tests: {
    status: string;
    results?: { annotations?: { type: string }[] }[];
  }[];
};
type ReportSuite = { specs?: ReportSpec[]; suites?: ReportSuite[] };

const LEDGER = dirname(fileURLToPath(import.meta.url));
const SUITE = dirname(LEDGER);
const TEST_ID = /^[A-Z]+-\d{2}$/;
const TEST_TITLE =
  /^\s*test(?:\.fail|\.fixme|\.skip)?\(\s*['"`]([A-Z]+-\d{2}) /gm;

function rows(file: string, columns: number): string[][] {
  return readFileSync(join(LEDGER, file), 'utf8')
    .split('\n')
    .slice(1)
    .filter((line) => line.trim() !== '')
    .map((line, index) => {
      const cells = line.split('\t');
      if (cells.length !== columns) {
        throw new Error(
          `${file} line ${index + 2}: ${cells.length} columns, expected ${columns}`
        );
      }
      return cells.map((cell) => cell.trim());
    });
}

function testsInSpecs(): Map<string, string> {
  const found = new Map<string, string>();
  for (const file of readdirSync(SUITE)) {
    if (!file.endsWith('.spec.ts')) continue;
    const source = readFileSync(join(SUITE, file), 'utf8');
    for (const match of source.matchAll(TEST_TITLE)) {
      const id = match[1];
      const earlier = found.get(id);
      if (earlier) throw new Error(`${id} is in ${earlier} and in ${file}`);
      found.set(id, file);
    }
  }
  return found;
}

function specsOf(suite: ReportSuite): ReportSpec[] {
  return [
    ...(suite.specs ?? []),
    ...(suite.suites ?? []).flatMap((inner) => specsOf(inner)),
  ];
}

type Outcome = { status: string; defectSeen: boolean };

function outcomes(reportFile: string): Map<string, Outcome> {
  const report = JSON.parse(readFileSync(reportFile, 'utf8')) as ReportSuite;
  const found = new Map<string, Outcome>();
  for (const spec of specsOf(report)) {
    const id = spec.title.split(' ')[0];
    found.set(id, {
      status: spec.tests.map((test) => test.status).join(','),
      defectSeen: spec.tests.some((test) =>
        (test.results ?? []).some((result) =>
          (result.annotations ?? []).some(
            (note) => note.type === 'intermittent-defect'
          )
        )
      ),
    });
  }
  return found;
}

const inventory: InventoryRow[] = rows('inventory.tsv', 4).map(
  ([item, behaviour, tests, reason]) => ({
    item,
    behaviour,
    tests: tests === '' ? [] : tests.split(',').map((id) => id.trim()),
    reason,
  })
);
const defects: DefectRow[] = rows('known-defects.tsv', 2).map(
  ([test, defect]) => ({ test, defect })
);
const sometimes: DefectRow[] = rows('intermittent-defects.tsv', 2).map(
  ([test, defect]) => ({ test, defect })
);

const tests = testsInSpecs();
const problems: string[] = [];
const listed = new Set(inventory.flatMap((row) => row.tests));

for (const row of inventory) {
  if (row.tests.length === 0 && row.reason === '') {
    problems.push(`inventory ${row.item}: no test and no reason`);
  }
  for (const id of row.tests) {
    if (!TEST_ID.test(id)) problems.push(`inventory ${row.item}: bad id ${id}`);
    else if (!tests.has(id))
      problems.push(`inventory ${row.item}: ${id} is not a test`);
  }
}
for (const id of tests.keys()) {
  if (!listed.has(id)) problems.push(`${id}: not in inventory.tsv`);
}
for (const id of [
  ...defects.map((row) => row.test),
  ...sometimes.map((row) => row.test),
]) {
  if (!tests.has(id)) problems.push(`${id}: in the ledger but not a test`);
}

const reportAt = process.argv.indexOf('--report');
if (reportAt !== -1) {
  const ran = outcomes(process.argv[reportAt + 1]);
  for (const id of tests.keys()) {
    const outcome = ran.get(id);
    if (outcome === undefined) problems.push(`${id}: did not run`);
    else if (outcome.status !== 'expected')
      problems.push(`${id}: ${outcome.status} in the run`);
    else if (outcome.defectSeen) {
      if (sometimes.some((row) => row.test === id))
        console.log(`${id}: its intermittent defect showed in the run`);
      else problems.push(`${id}: not in intermittent-defects.tsv`);
    }
  }
}

const covered = inventory.filter((row) => row.tests.length > 0).length;
console.log(
  `${tests.size} tests; ${covered} of ${inventory.length} listed behaviours covered, ` +
    `${inventory.length - covered} not, each with a reason; ${defects.length} known defects, ${sometimes.length} intermittent`
);
if (problems.length > 0) {
  console.error(problems.join('\n'));
  process.exit(1);
}
