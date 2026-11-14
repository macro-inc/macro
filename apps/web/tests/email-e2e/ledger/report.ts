// The coverage report of the email browser suite:
//
//   bun tests/email-e2e/ledger/report.ts [--enforce]
//
// reads the last run (`ledger-results/`) and writes `ledger-results/report/`:
// `ledger.json`, `summary.md` (appended to the CI job summary), `index.html`
// and a copy of Playwright's JSON report of each run. It only
// reports, unless `--enforce` or EMAIL_E2E_LEDGER_ENFORCE=1 is given: then a
// row without a test or a waiver, or a manifest that differs from the
// source, fails it.

import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  writeFileSync,
} from 'node:fs';
import { stripVTControlCharacters } from 'node:util';
import { EMAIL_SOURCE } from './derive';
import { readRun } from './evidence';
import {
  buildLedger,
  type Ledger,
  type OperationRow,
  type Row,
  type Totals,
  totals,
} from './ledger';
import { REPORT, type Run, runPaths, WEB } from './paths';

const percent = (part: number, whole: number) =>
  whole === 0 ? '–' : `${((100 * part) / whole).toFixed(1)}%`;

const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

type Table = { head: string[]; rows: (string | number)[][] };

function markdown(table: Table): string {
  const line = (cells: (string | number)[]) =>
    `| ${cells.map((cell) => String(cell).replace(/\|/g, '\\|')).join(' | ')} |`;
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

function operationTotals(operations: OperationRow[]): Totals {
  const real = operations.filter((each) => each.count > 0);
  return {
    total: operations.length,
    waived: operations.filter((each) => each.status === 'waived').length,
    deferred: operations.filter((each) => each.status === 'deferred').length,
    covered: real.length,
    complete: operations.filter((each) => each.status === 'covered').length,
    bothProviders: operations.filter((each) => each.status === 'covered')
      .length,
    gmail: real.filter((each) => each.providers.includes('gmail')).length,
    outlook: real.filter((each) => each.providers.includes('outlook')).length,
    desktop: real.filter((each) => each.viewports.includes('desktop')).length,
    phone: real.filter((each) => each.viewports.includes('phone')).length,
  };
}

function lineTables(ledger: Ledger): {
  email: { lines: number; covered: number; files: number };
  byDirectory: Table;
  neverLoaded: string[];
  files: Table;
  cited: Table;
} {
  const email = [...ledger.lines.files].filter(([file]) =>
    ledger.lines.email(file)
  );
  const sum = (entries: typeof email) => ({
    lines: entries.reduce((all, [, each]) => all + each.lines, 0),
    covered: entries.reduce((all, [, each]) => all + each.covered, 0),
    files: entries.length,
  });
  const directories = EMAIL_SOURCE.map((dir) => {
    const inside = email.filter(([file]) =>
      file.startsWith(`apps/web/${dir}/`)
    );
    const of = sum(inside);
    return [
      dir,
      of.files,
      inside.filter(([, each]) => !each.loaded).length,
      of.lines,
      of.covered,
      percent(of.covered, of.lines),
    ];
  });
  const fileRow = ([file, each]: (typeof email)[number]) => [
    file.replace(/^apps\/web\//, ''),
    each.lines,
    each.covered,
    percent(each.covered, each.lines),
    each.loaded ? '' : 'never loaded',
  ];
  const head = ['File', 'Lines', 'Covered', '%', ''];
  return {
    email: sum(email),
    byDirectory: {
      head: ['Directory', 'Files', 'Never loaded', 'Lines', 'Covered', '%'],
      rows: directories,
    },
    neverLoaded: email
      .filter(([, each]) => !each.loaded)
      .map(([file]) => file.replace(/^apps\/web\//, '')),
    files: {
      head,
      rows: email
        .sort((a, b) => a[1].covered / a[1].lines - b[1].covered / b[1].lines)
        .map(fileRow),
    },
    cited: {
      head,
      rows: [...ledger.lines.files]
        .filter(([file]) => !ledger.lines.email(file))
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(fileRow),
    },
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

function render(ledger: Ledger): { summary: string; page: string } {
  const actions = ledger.rows.filter((row) => row.kind === 'action');
  const states = ledger.rows.filter((row) => row.kind === 'state');
  const email = ledger.operations.filter((each) => each.scope === 'email');
  const shared = ledger.operations.filter((each) => each.scope === 'shared');
  const lines = lineTables(ledger);

  const headline: Table = {
    head: TOTALS_HEAD,
    rows: [
      totalsRow('Actions', totals(actions)),
      totalsRow('States', totals(states)),
      totalsRow('Network operations (email)', operationTotals(email)),
      totalsRow('Network operations (shared)', operationTotals(shared)),
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
  const testsLine = `${tests.total} tests: ${tests.passed} passed, ${tests.flaky.length} passed only on a retry, ${tests.failed} failed, ${tests.skipped} skipped; ${tests.seconds} s of test time. ${tests.knownBugs} tests for known bugs are run apart and do not count.`;
  const linesLine = ledger.lines.measured
    ? `Lines of email source that ran: ${lines.email.covered} of ${lines.email.lines} (${percent(lines.email.covered, lines.email.lines)}) in ${lines.email.files} files; ${lines.neverLoaded.length} files no test loaded; ${ledger.lines.notBundled.length} files have no line in the bundle.`
    : 'Lines: not measured (no bundle, or no script coverage in the run).';
  const driftCount = ledger.drift.reduce(
    (sum, each) => sum + each.items.length,
    0
  );
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
    markdown(headline),
    '',
    `Covered: a passing, gating test did it at all. Complete: on every provider and every layout the row applies to. ${open.length} rows are open, ${partial.length} are covered in part, ${deferred.length} wait for the full-stack tier, ${waived.length} are waived.`,
    '',
    linesLine,
    '',
    tests.flaky.length
      ? `### Tests that passed only on a retry\n\n${markdown(flaky)}`
      : 'No test needed a retry.',
    '',
    `### Manifest against the source: ${driftCount} differences`,
    '',
    driftCount ? details('The differences', driftList(false)) : '',
    '',
    details('By group', markdown(byGroup)),
    '',
    ledger.lines.measured
      ? details('Lines by directory', markdown(lines.byDirectory))
      : '',
    '',
    `The whole report, with every open row, is in the \`email-e2e-browser-coverage\` artifact (\`index.html\`).`,
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
<p class="mut">The email browser suite (<code>apps/web/tests/email-e2e</code>) against the manifest of every email action and state in the web app. Evidence is what the tests recorded while they ran.</p>
<p>${escapeHtml(testsLine)}</p>
${html(headline)}
<p><b>Covered</b>: a passing, gating test did it at all. <b>Both providers</b>: on Gmail and on Outlook. <b>Complete</b>: on every provider and every layout the row applies to. <b>Deferred</b>: needs a service the per-test stack does not run. Percentages leave out waived rows.</p>
<p>${escapeHtml(linesLine)}</p>
${section('By group', html(byGroup))}
${section('By surface', html(bySurface))}
${section(`Open rows (${open.length})`, groups.map((group) => folded(`${group} (${open.filter((row) => row.group === group).length})`, html(rowTable(open.filter((row) => row.group === group))))).join(''))}
${section(`Covered in part (${partial.length})`, folded('Rows', html(rowTable(partial))))}
${section(`Deferred to the full-stack tier (${deferred.length})`, folded('Rows', html(rowTable(deferred))))}
${section(`Waived (${waived.length})`, folded('Rows', html(rowTable(waived))))}
${section('Network operations', `<p>Email and shared operations; the ${ledger.operations.filter((each) => each.scope === 'other').length} that no email code makes are left out. Covered: a real service answered it without an error. Stubbed: only a stand-in answered. Failed: a service answered only with errors.</p>${html(operations)}${folded(`Requests the app made that the manifest does not list (${ledger.unlisted.length})`, html(unlisted))}`)}
${section('Lines', ledger.lines.measured ? `<p>From Chromium's own coverage of the bundle's scripts, through the bundle's source maps. A line counts when the bundle has code for it; it ran when any of that code ran in a passing test. Code that runs in a worker is not seen.</p>${html(lines.byDirectory)}${folded(`Files no test loaded (${lines.neverLoaded.length})`, `<ul>${lines.neverLoaded.map((file) => `<li><code>${escapeHtml(file)}</code></li>`).join('')}</ul>`)}${folded(`Files with no line in the bundle (${ledger.lines.notBundled.length})`, `<p>Types only, or not reachable from the app.</p><ul>${ledger.lines.notBundled.map((file) => `<li><code>${escapeHtml(file)}</code></li>`).join('')}</ul>`)}${folded('Every email source file, least covered first', html(lines.files))}${folded('Other files the manifest names', html(lines.cited))}` : '<p>Not measured in this run.</p>')}
${section(`Manifest against the source (${driftCount} differences)`, driftCount ? driftList(true) : '<p>None.</p>')}
${section('Tests that passed only on a retry', tests.flaky.length ? html(flaky) : '<p>None.</p>')}
</main></body></html>`;
  return { summary, page };
}

function main(): void {
  const enforce =
    process.argv.includes('--enforce') ||
    process.env.EMAIL_E2E_LEDGER_ENFORCE === '1';
  const gating = readRun('gating');
  if (!gating.found) {
    console.error('no run to report: run the suite first');
    process.exit(enforce ? 1 : 0);
  }
  const dist = process.env.EMAIL_E2E_DIST ?? `${WEB}dist`;
  const ledger = buildLedger(gating, readRun('known-bugs'), dist);
  const { summary, page } = render(ledger);

  mkdirSync(REPORT, { recursive: true });
  writeFileSync(
    `${REPORT}/ledger.json`,
    JSON.stringify(
      {
        tests: ledger.tests,
        actions: totals(ledger.rows.filter((row) => row.kind === 'action')),
        states: totals(ledger.rows.filter((row) => row.kind === 'state')),
        rows: ledger.rows,
        operations: ledger.operations,
        unlisted: ledger.unlisted,
        drift: ledger.drift,
        lines: {
          measured: ledger.lines.measured,
          files: Object.fromEntries(ledger.lines.files),
          notBundled: ledger.lines.notBundled,
        },
        droppedEvidence: gating.dropped,
      },
      null,
      1
    )
  );
  writeFileSync(`${REPORT}/summary.md`, summary);
  writeFileSync(`${REPORT}/index.html`, page);
  for (const run of ['gating', 'known-bugs'] satisfies Run[]) {
    const from = runPaths(run).playwright;
    if (existsSync(from)) copyFileSync(from, `${REPORT}/playwright-${run}.json`);
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
  }
  console.log(summary.split('\n').slice(0, 12).join('\n'));
  console.log(`\nreport: ${REPORT}/index.html`);

  if (!enforce) return;
  const open = ledger.rows.filter(
    (row) => row.status === 'open' || row.status === 'partial'
  );
  const openOperations = ledger.operations.filter(
    (each) =>
      each.scope === 'email' &&
      !['covered', 'waived', 'deferred'].includes(each.status)
  );
  const drift = ledger.drift.reduce((sum, each) => sum + each.items.length, 0);
  if (open.length + openOperations.length + drift > 0) {
    console.error(
      `\nnot covered: ${open.length} rows, ${openOperations.length} network operations; ${drift} differences between the manifest and the source`
    );
    process.exit(1);
  }
}

main();
