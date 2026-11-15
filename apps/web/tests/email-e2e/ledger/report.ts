// The coverage report of the email browser suite:
//
//   bun tests/email-e2e/ledger/report.ts [--enforce | --record]
//
// reads the last run (`ledger-results/`) and writes `ledger-results/report/`:
// `ledger.json`, `summary.md` (appended to the CI job summary), `index.html`
// and a copy of Playwright's JSON report of each run. It only reports,
// unless `--enforce` or EMAIL_E2E_LEDGER_ENFORCE=1 is given: then what
// `enforce.ts` finds, or a manifest that differs from the source, fails it.
// `--record` writes `full-stack-only.tsv` from a run of both stacks.

import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  writeFileSync,
} from 'node:fs';
import { fileURLToPath } from 'node:url';
import { stripVTControlCharacters } from 'node:util';
import { coveredItems, fullStackOnly, STACK, violations } from './enforce';
import { readGatingRuns, readRun } from './evidence';
import {
  buildLedger,
  type FunctionRow,
  functionTotals,
  type Ledger,
  type OperationRow,
  type Row,
  type Totals,
  totals,
} from './ledger';
import {
  FULL_STACK_ONLY,
  FUNCTIONS,
  PROOFS,
  WAIVERS,
  type Waiver,
} from './manifest/functions';
import { GATING_RUNS, REPORT, type Run, runPaths } from './paths';

const percent = (part: number, whole: number) =>
  whole === 0 ? '–' : `${((100 * part) / whole).toFixed(1)}%`;

const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

type Table = { head: string[]; rows: (string | number)[][] };

function markdown(table: Table): string {
  const line = (cells: (string | number)[]) =>
    `| ${cells.map((cell) => String(cell).replace(/[|<>`]/g, '\\$&')).join(' | ')} |`;
  return [
    line(table.head),
    line(table.head.map(() => '---')),
    ...table.rows.map(line),
  ].join('\n');
}

function html(table: Table): string {
  const cell = (tag: string, value: string | number) =>
    `<${tag}${typeof value === 'number' ? ' class="n"' : ''}>${escapeHtml(String(value))}</${tag}>`;
  return `<div class="tw"><table><thead><tr>${table.head.map((each) => cell('th', each)).join('')}</tr></thead><tbody>${table.rows
    .map((row) => `<tr>${row.map((each) => cell('td', each)).join('')}</tr>`)
    .join('')}</tbody></table></div>`;
}

const TOTALS_HEAD = [
  '',
  'Total',
  'Covered',
  '%',
  'Both providers',
  'Gmail',
  'Outlook',
  'Desktop',
  'Phone',
  'Complete',
  'Deferred',
  'Waived',
];

function totalsRow(name: string, of: Totals): (string | number)[] {
  return [
    name,
    of.total,
    of.covered,
    percent(of.covered, of.total - of.waived),
    of.bothProviders,
    of.gmail,
    of.outlook,
    of.desktop,
    of.phone,
    of.complete,
    of.deferred,
    of.waived,
  ];
}

const OPERATIONS_HEAD = [
  '',
  'Total',
  'Answered by a service',
  '%',
  'With every provider',
  'Gmail',
  'Outlook',
  'Desktop',
  'Phone',
  'Deferred',
];

function operationsRow(
  name: string,
  operations: OperationRow[]
): (string | number)[] {
  const real = operations.filter((each) => each.count > 0);
  return [
    name,
    operations.length,
    real.length,
    percent(real.length, operations.length),
    operations.filter((each) => each.status === 'covered').length,
    real.filter((each) => each.providers.includes('gmail')).length,
    real.filter((each) => each.providers.includes('outlook')).length,
    real.filter((each) => each.viewports.includes('desktop')).length,
    real.filter((each) => each.viewports.includes('phone')).length,
    operations.filter((each) => each.status === 'deferred').length,
  ];
}

const FUNCTION_HEAD = [
  '',
  'Functions',
  'Covered and proved',
  '%',
  'Covered, not proved',
  'Gmail',
  'Outlook',
  'In part',
  'Open',
  'Deferred',
  'Waived',
];

function functionTotalsRow(
  name: string,
  rows: readonly FunctionRow[]
): (string | number)[] {
  const of = functionTotals(rows);
  return [
    name,
    of.total,
    of.proved,
    percent(of.proved, of.total - of.waived),
    of.covered - of.proved,
    of.gmail,
    of.outlook,
    of.partial,
    of.open,
    of.deferred,
    of.waived,
  ];
}

const FUNCTION_WAIVERS = new Map(
  WAIVERS.filter((waiver) => waiver.on !== '-').map((waiver) => [
    waiver.id,
    waiver,
  ])
);

function waiverText(id: string): string {
  const waiver = FUNCTION_WAIVERS.get(id);
  if (!waiver) return '';
  const where = waiver.on === 'both' ? 'both providers' : waiver.on;
  return `waived on ${where} (${waiver.kind}): ${waiver.reason}`;
}

const WAIVER_KINDS: Record<Waiver['kind'], string> = {
  bug: 'A bug of the app that is not fixed; a test tagged @known-bug waits for it',
  needs: 'Needs a service or a clock no test stack gives a test yet',
  'native-only': 'Exists only in the native apps',
  'no-user-path': 'No user can reach it in the web app',
  backlog:
    'Not tested itself, and reported as open; most are another way into a function that is covered',
};

const ENFORCED =
  'With --enforce the report fails when a function on a provider, or a row, that is not in waivers.tsv has no passing test on the stack it belongs to (the full-stack tier for what full-stack-only.tsv lists, the per-test stack for the rest); when a passing test covers something waivers.tsv waives; when a function with a test has no line in proofs.tsv; when a test tagged @known-bug passes (unless it is also tagged @sometimes: a bug that shows only in some runs); and when the manifest differs from the source. A row seen on one provider or layout of several counts as tested.';

function waiverTable(): Table {
  return {
    head: ['Kind', 'What it means', 'Functions', 'Rows'],
    rows: Object.entries(WAIVER_KINDS).map(([kind, means]) => [
      kind,
      means,
      WAIVERS.filter((each) => each.kind === kind && each.on !== '-').length,
      WAIVERS.filter((each) => each.kind === kind && each.on === '-').length,
    ]),
  };
}

function functionTable(functions: FunctionRow[], rows: Row[]): Table {
  const seen = new Set(
    rows.filter((row) => row.cells.length > 0).map((row) => row.id)
  );
  const on = (fn: FunctionRow, provider: 'gmail' | 'outlook') =>
    !fn.providers.includes(provider)
      ? 'n/a'
      : fn.on[provider].covered
        ? 'yes'
        : fn.on[provider].tests.length > 0
          ? 'in part'
          : 'no';
  return {
    head: [
      'Id',
      'Area',
      'Function',
      'Checked at',
      'Status',
      'Proved by',
      'Gmail',
      'Outlook',
      'Ways to do it',
      'Missing',
    ],
    rows: functions.map((fn) => [
      fn.id,
      fn.area,
      fn.name,
      fn.checkedAt === 'ui' ? 'UI' : `UI and ${fn.checkedAt}`,
      fn.status,
      fn.proof ?? 'not proved',
      on(fn, 'gmail'),
      on(fn, 'outlook'),
      `${fn.variants.filter((id) => seen.has(id)).length} of ${fn.variants.length} tested`,
      [
        fn.reason ?? fn.missing.join('; '),
        waiverText(fn.id),
        fn.limit ? `does not prove: ${fn.limit}` : '',
      ]
        .filter(Boolean)
        .join('. '),
    ]),
  };
}

function rowTable(rows: Row[]): Table {
  return {
    head: ['Id', 'Surface', 'What', 'How', 'Applies to', 'Seen on', 'Missing'],
    rows: rows.map((row) => [
      row.id,
      `${row.surface} ${row.surfaceName}`,
      row.text,
      row.trigger,
      `${row.providers.join(', ')}; ${row.viewports.join(', ')}`,
      row.cells.join(', ') +
        (row.knownBugOnly ? ' (a known-bug test only)' : ''),
      row.reason ?? row.missing.join(', '),
    ]),
  };
}

function render(
  ledger: Ledger,
  failures: readonly string[],
  runs: readonly string[]
): { summary: string; page: string } {
  const actions = ledger.rows.filter((row) => row.kind === 'action');
  const states = ledger.rows.filter((row) => row.kind === 'state');
  const email = ledger.operations.filter((each) => each.scope === 'email');
  const shared = ledger.operations.filter((each) => each.scope === 'shared');
  const withUi = ledger.functions.filter((fn) => fn.status !== 'backend');
  const backend = ledger.functions.filter((fn) => fn.status === 'backend');
  const areas = [...new Set(withUi.map((fn) => fn.area))];
  const functionsHeadline: Table = {
    head: FUNCTION_HEAD,
    rows: [functionTotalsRow('Email functions with a UI', withUi)],
  };
  const functionsByArea: Table = {
    head: ['Area', ...FUNCTION_HEAD.slice(1)],
    rows: areas.map((area) =>
      functionTotalsRow(
        area,
        withUi.filter((fn) => fn.area === area)
      )
    ),
  };
  const ft = functionTotals(ledger.functions);
  const functionsLine = `${ft.total} functions a user can do in the web app: ${ft.proved} covered and proved, ${ft.covered - ft.proved} covered and not proved (${ft.gmail} pass on Gmail, ${ft.outlook} on Outlook), ${ft.partial} in part, ${ft.open} open, ${ft.deferred} wait for a service no stack gives a test, ${ft.waived} waived. ${ft.backend} more have no UI and are counted by the backend's coverage.`;

  const headline: Table = {
    head: TOTALS_HEAD,
    rows: [
      totalsRow('Actions', totals(actions)),
      totalsRow('States', totals(states)),
    ],
  };
  const operationsHeadline: Table = {
    head: OPERATIONS_HEAD,
    rows: [
      operationsRow('Network operations (email)', email),
      operationsRow('Network operations (shared)', shared),
    ],
  };
  const groups = [...new Set(ledger.rows.map((row) => row.group))];
  const byGroup: Table = {
    head: ['Group', ...TOTALS_HEAD.slice(1)],
    rows: groups.flatMap((group) => [
      totalsRow(
        `${group}: actions`,
        totals(actions.filter((row) => row.group === group))
      ),
      totalsRow(
        `${group}: states`,
        totals(states.filter((row) => row.group === group))
      ),
    ]),
  };
  const surfaces = [...new Set(ledger.rows.map((row) => row.surface))];
  const bySurface: Table = {
    head: [
      'Surface',
      'Group',
      'Actions',
      'covered',
      'both',
      'States',
      'covered',
      'both',
    ],
    rows: surfaces.map((surface) => {
      const of = ledger.rows.filter((row) => row.surface === surface);
      const a = totals(of.filter((row) => row.kind === 'action'));
      const s = totals(of.filter((row) => row.kind === 'state'));
      return [
        `${surface} ${of[0].surfaceName}`,
        of[0].group,
        a.total,
        a.covered,
        a.bothProviders,
        s.total,
        s.covered,
        s.bothProviders,
      ];
    }),
  };
  const operations: Table = {
    head: [
      'Operation',
      'Kind',
      'Scope',
      'Status',
      'Providers',
      'Layouts',
      'Times',
    ],
    rows: ledger.operations
      .filter((each) => each.scope !== 'other')
      .map((each) => [
        each.id,
        each.kind,
        each.scope,
        each.status + (each.needs ? `: ${each.needs}` : ''),
        each.providers.join(', '),
        each.viewports.join(', '),
        each.count,
      ]),
  };
  const unlisted: Table = {
    head: ['Request', 'Answered by', 'Times'],
    rows: ledger.unlisted.map((each) => [
      each.request,
      each.answeredBy,
      each.count,
    ]),
  };
  const flaky: Table = {
    head: ['Test', 'Failed attempts', 'First failure'],
    rows: ledger.tests.flaky.map((test) => [
      `${test.file}:${test.line} ${test.title}`,
      test.results.filter((result) => result.status !== 'passed').length,
      stripVTControlCharacters(
        test.results.find((result) => result.status !== 'passed')?.error
          ?.message ?? ''
      )
        .split('\n')[0]
        .slice(0, 200),
    ]),
  };
  const tests = ledger.tests;
  const testsLine = `${tests.total} tests (${tests.onBothStacks} of them run on both the per-test stack and the full-stack tier, and are counted once): ${tests.passed} passed, ${tests.flaky.length} passed only on a retry, ${tests.failed} failed, ${tests.skipped} skipped; ${tests.seconds} s of test time. ${tests.knownBugs} tests for known bugs are run apart and do not count.`;
  const fromLine =
    runs.length > 1
      ? `Counted from the runs on ${runs.join(' and ')}.`
      : `Counted from the run on ${runs[0]} alone: what only the other stack's tests cover shows here as not covered, and is held to that stack's own run.`;
  const driftCount = ledger.drift.reduce(
    (sum, each) => sum + each.items.length,
    0
  );
  const limits = ledger.functions.filter((fn) => fn.limit);
  const limitTable: Table = {
    head: ['Id', 'Function', 'Its tests do not prove'],
    rows: limits.map((fn) => [fn.id, fn.name, fn.limit ?? '']),
  };
  const open = ledger.rows.filter((row) => row.status === 'open');
  const partial = ledger.rows.filter((row) => row.status === 'partial');
  const deferred = ledger.rows.filter((row) => row.status === 'deferred');
  const waived = ledger.rows.filter((row) => row.status === 'waived');

  const details = (title: string, body: string) =>
    `<details><summary>${escapeHtml(title)}</summary>\n\n${body}\n\n</details>`;
  const driftList = (asHtml: boolean) =>
    ledger.drift
      .map((each) =>
        asHtml
          ? `<h3>${escapeHtml(each.check)} (${each.items.length})</h3><ul>${each.items.map((item) => `<li><code>${escapeHtml(item)}</code></li>`).join('')}</ul>`
          : `**${each.check}** (${each.items.length})\n\n${each.items.map((item) => `- \`${item}\``).join('\n')}`
      )
      .join('\n\n');

  const summary = [
    '## Email UI coverage',
    '',
    testsLine,
    '',
    fromLine,
    '',
    '### Functions',
    '',
    functionsLine,
    '',
    markdown(functionsHeadline),
    '',
    'A function is covered when one passing, gating test does it through the UI and checks its result on the screen and at the provider (in the service where the provider sees nothing of it), on Gmail and on Outlook.',
    '',
    details('Functions by area', markdown(functionsByArea)),
    '',
    details(
      `Functions not covered (${withUi.filter((fn) => fn.status !== 'covered').length})`,
      markdown(
        functionTable(
          withUi.filter((fn) => fn.status !== 'covered'),
          ledger.rows
        )
      )
    ),
    '',
    '### Rows: the ways to do each function, and what the app shows',
    '',
    markdown(headline),
    '',
    `Covered: a passing, gating test did it at all. Complete: on every provider and every layout the row applies to. ${open.length} rows are open, ${partial.length} are covered in part, ${deferred.length} wait for a service no stack gives a test, ${waived.length} are waived.`,
    '',
    markdown(operationsHeadline),
    '',
    'Network operations are reported only: nothing here fails the job for one.',
    '',
    '### What fails the job',
    '',
    ENFORCED,
    '',
    failures.length
      ? `**${failures.length} of them now:**\n\n${failures.map((each) => `- ${each}`).join('\n')}`
      : 'Nothing does in this run.',
    '',
    details('Waivers by kind', markdown(waiverTable())),
    '',
    limits.length
      ? details(
          'What the tests of a covered function do not prove',
          markdown(limitTable)
        )
      : '',
    '',
    tests.flaky.length
      ? `### Tests that passed only on a retry\n\n${markdown(flaky)}`
      : 'No test needed a retry.',
    '',
    `### Manifest against the source: ${driftCount} differences`,
    '',
    driftCount ? details('The differences', driftList(false)) : '',
    '',
    details('Rows by group', markdown(byGroup)),
    '',
    `The whole report, with every function's rows and every open row, is in the job's coverage artifact (\`index.html\`).`,
    '',
  ].join('\n');

  const section = (title: string, body: string) =>
    `<h2>${escapeHtml(title)}</h2>${body}`;
  const folded = (title: string, body: string) =>
    `<details><summary>${escapeHtml(title)}</summary>${body}</details>`;
  const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Email UI coverage</title><style>
:root{--bg:#fff;--fg:#1b1d21;--mut:#5b616b;--line:#dfe2e7;--acc:#1d5fd1;--card:#f6f7f9}
@media (prefers-color-scheme:dark){:root{--bg:#15171a;--fg:#e7e9ec;--mut:#9aa1ab;--line:#2c3036;--acc:#7fb0ff;--card:#1d2024}}
body{background:var(--bg);color:var(--fg);font:16px/1.55 system-ui,sans-serif;margin:0;padding:24px 16px 80px}
main{max-width:1100px;margin:0 auto}h1{font-size:28px;margin:0 0 4px}h2{font-size:21px;margin:40px 0 8px;border-top:1px solid var(--line);padding-top:24px}
h3{font-size:17px;margin:24px 0 6px}p,li{max-width:80ch}.mut{color:var(--mut)}
table{border-collapse:collapse;width:100%;margin:12px 0;font-size:14px}th,td{border:1px solid var(--line);padding:5px 8px;text-align:left;vertical-align:top}
th{background:var(--card)}td.n,th.n{text-align:right;white-space:nowrap}.tw{overflow-x:auto}code{font-size:13px;overflow-wrap:anywhere}
summary{cursor:pointer;margin:10px 0;color:var(--acc)}
</style></head><body><main>
<h1>Email UI coverage</h1>
<p class="mut">The email browser suite (<code>apps/web/tests/email-e2e</code>) against the list of what a user does with email, and the manifest of every way to do it in the web app. Evidence is what the tests recorded while they ran.</p>
<p>${escapeHtml(testsLine)}</p>
<p>${escapeHtml(fromLine)}</p>
<h2>Functions</h2>
<p>${escapeHtml(functionsLine)}</p>
${html(functionsHeadline)}
<p>A function is <b>covered</b> when one passing, gating test does it through the UI and checks its result on the screen and at the provider (in the service where the provider sees nothing of it), on Gmail and on Outlook. <b>In part</b>: a test touches it, but not all of that. <b>Deferred</b>: every way to do it needs a service no stack gives a test.</p>
${limits.length ? `<h3>What the tests of a covered function do not prove</h3>${html(limitTable)}` : ''}
${html(functionsByArea)}
${areas
  .map((area) =>
    folded(
      `${area} (${withUi.filter((fn) => fn.area === area).length})`,
      html(
        functionTable(
          withUi.filter((fn) => fn.area === area),
          ledger.rows
        )
      ) +
        withUi
          .filter((fn) => fn.area === area)
          .map((fn) =>
            folded(
              `${fn.id} ${fn.name}: its rows (${fn.variants.length + fn.states.length})`,
              html(
                rowTable(ledger.rows.filter((row) => row.fn.includes(fn.id)))
              )
            )
          )
          .join('')
    )
  )
  .join('')}
${folded(`Functions without a UI (${backend.length})`, html({ head: ['Id', 'Area', 'Function'], rows: backend.map((fn) => [fn.id, fn.area, fn.name]) }))}
<h2>Rows: the ways to do each function, and what the app shows</h2>
${html(headline)}
<p><b>Covered</b>: a passing, gating test did it at all. <b>Both providers</b>: on Gmail and on Outlook. <b>Complete</b>: on every provider and every layout the row applies to. <b>Deferred</b>: needs a service or a clock no stack gives a test. <b>Open</b>: no test does it; each has a line in <code>waivers.tsv</code> of the kind <code>backlog</code>, or fails the job. Percentages leave out waived rows.</p>
${section('What fails the job', `<p>${escapeHtml(ENFORCED)}</p>${failures.length ? `<p><b>${failures.length} of them now:</b></p><ul>${failures.map((each) => `<li>${escapeHtml(each)}</li>`).join('')}</ul>` : '<p>Nothing does in this run.</p>'}${html(waiverTable())}`)}
${section('By group', html(byGroup))}
${section('By surface', html(bySurface))}
${section(`Open rows (${open.length})`, groups.map((group) => folded(`${group} (${open.filter((row) => row.group === group).length})`, html(rowTable(open.filter((row) => row.group === group))))).join(''))}
${section(`Covered in part (${partial.length})`, folded('Rows', html(rowTable(partial))))}
${section(`Deferred: needs a service no stack gives a test (${deferred.length})`, folded('Rows', html(rowTable(deferred))))}
${section(`Waived (${waived.length})`, folded('Rows', html(rowTable(waived))))}
${section('Network operations', `<p>Email and shared operations; the ${ledger.operations.filter((each) => each.scope === 'other').length} that no email code makes are left out. Covered: a real service answered it without an error. Stubbed: only a stand-in answered. Failed: a service answered only with errors. With every provider: with Gmail and with Outlook, or with the one provider the app makes it for. Network operations are reported only: nothing fails the job for one.</p>${html(operationsHeadline)}${html(operations)}${folded(`Requests the app made that the manifest does not list (${ledger.unlisted.length})`, html(unlisted))}`)}
${section(`Manifest against the source (${driftCount} differences)`, driftCount ? driftList(true) : '<p>None.</p>')}
${section('Tests that passed only on a retry', tests.flaky.length ? html(flaky) : '<p>None.</p>')}
</main></body></html>`;
  return { summary, page };
}

type Mode = 'report' | 'enforce' | 'record';

/** Where `--record` writes. */
const FULL_STACK_ONLY_FILE = fileURLToPath(
  new URL('./full-stack-only.tsv', import.meta.url)
);

function report(mode: Mode): void {
  const gating = readGatingRuns();
  if (!gating.found) {
    console.error('no run to report: run the suite first');
    process.exit(mode === 'report' ? 0 : 1);
  }
  const knownBugs = readRun('known-bugs');
  const ledger = buildLedger(gating, knownBugs);

  // Each stack's run by itself: what it covers is held against its own part.
  const covered = Object.fromEntries(
    GATING_RUNS.flatMap((run) => {
      const result = readRun(run);
      return result.found
        ? [[run, coveredItems(buildLedger(result, knownBugs))] as const]
        : [];
    })
  );
  if (mode === 'record') {
    if (!covered.gating || !covered['full-stack']) {
      console.error('--record needs a run of both stacks');
      process.exit(1);
    }
    writeFileSync(
      FULL_STACK_ONLY_FILE,
      fullStackOnly(
        { gating: covered.gating, 'full-stack': covered['full-stack'] },
        WAIVERS
      )
    );
    console.log(`wrote ${FULL_STACK_ONLY_FILE}`);
    return;
  }
  const failures = [
    ...violations({
      functions: FUNCTIONS,
      rows: ledger.rows.map((row) => row.id),
      proofs: PROOFS,
      waivers: WAIVERS,
      fullStackOnly: FULL_STACK_ONLY,
      covered,
      knownBugsPassing: knownBugs.tests
        // One pass of a bug that shows only sometimes says nothing.
        .filter((test) => test.status === 'expected' && !test.sometimes)
        .map((test) => `${test.file}:${test.line} ${test.title}`),
    }),
    // A run that left no result cannot say that no such test passes.
    ...(knownBugs.found
      ? []
      : [
          'the tests kept for known bugs were not run: run them (EMAIL_E2E_KNOWN_BUGS=1) before the check',
        ]),
    ...ledger.drift.flatMap((each) =>
      each.items.map((item) => `${each.check}: ${item}`)
    ),
  ];
  const { summary, page } = render(
    ledger,
    failures,
    GATING_RUNS.filter((run) => covered[run]).map((run) => STACK[run])
  );

  mkdirSync(REPORT, { recursive: true });
  writeFileSync(
    `${REPORT}/ledger.json`,
    JSON.stringify(
      {
        tests: ledger.tests,
        functionTotals: functionTotals(ledger.functions),
        functions: ledger.functions,
        actions: totals(ledger.rows.filter((row) => row.kind === 'action')),
        states: totals(ledger.rows.filter((row) => row.kind === 'state')),
        rows: ledger.rows,
        operations: ledger.operations,
        unlisted: ledger.unlisted,
        drift: ledger.drift,
        droppedEvidence: gating.dropped,
        failures,
      },
      null,
      1
    )
  );
  writeFileSync(`${REPORT}/summary.md`, summary);
  writeFileSync(`${REPORT}/index.html`, page);
  for (const run of ['gating', 'full-stack', 'known-bugs'] satisfies Run[]) {
    const from = runPaths(run).playwright;
    if (existsSync(from))
      copyFileSync(from, `${REPORT}/playwright-${run}.json`);
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
  }
  console.log(summary.split('\n').slice(0, 10).join('\n'));
  console.log(`\nreport: ${REPORT}/index.html`);

  if (mode !== 'enforce' || failures.length === 0) return;
  console.error(
    `\nthe coverage ledger fails (${failures.length}):\n${failures.map((each) => `  ${each}`).join('\n')}`
  );
  process.exit(1);
}

/**
 * When the report only reports, nothing in it fails the job: a run cut
 * short leaves evidence it cannot read, and that is the suite's failure.
 */
function main(): void {
  const mode: Mode = process.argv.includes('--record')
    ? 'record'
    : process.argv.includes('--enforce') ||
        process.env.EMAIL_E2E_LEDGER_ENFORCE === '1'
      ? 'enforce'
      : 'report';
  try {
    report(mode);
  } catch (error) {
    if (mode !== 'report') throw error;
    console.error('no coverage report:', error);
  }
}

main();
