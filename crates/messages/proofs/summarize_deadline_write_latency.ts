#!/usr/bin/env bun
// Validate the final release repository matrix without replacing historical
// evidence.
import {
  allFinite,
  check,
  checkSourceRevision,
  compareKeys,
  formatFixed,
  groupOf,
  groupRows,
  isAscending,
  median,
  missingArguments,
  parseCommandLine,
  ratesAgree,
  readLines,
  runProof,
  sameKeys,
  tableCells,
  toFloat,
  toInt,
  toRow,
  usageError,
  writeReport,
  writeRunsCsv,
} from './proof_support';

const HELP = `usage: summarize_deadline_write_latency.ts [-h]
                                           --source-revision SOURCE_REVISION
                                           [--output OUTPUT]
                                           [--implementation {deadline,admission}]
                                           logs [logs ...]

Validate the final release repository matrix without replacing historical
evidence.

positional arguments:
  logs

options:
  -h, --help            show this help message and exit
  --source-revision SOURCE_REVISION
                        exact tested implementation revision, including any
                        working-tree qualifier
  --output OUTPUT
  --implementation {deadline,admission}
`;

const FIELDS = [
  'runtime',
  'profile',
  'run',
  'writers',
  'channels',
  'operation',
  'variant',
  'n',
  'median_ms',
  'p95_ms',
  'p99_ms',
  'total_wall_ms',
  'throughput_ops_s',
] as const;
type Field = (typeof FIELDS)[number];
type Row = Record<Field, string>;

// Writers and channels of each measured layout, as `writers|channels`.
const LAYOUTS = ['1|1', '4|1', '16|1', '16|16'];
const OPERATIONS = ['Create', 'Edit', 'React', 'Delete'];
const VARIANTS = ['before', 'after'];
const LATENCY = ['median_ms', 'p95_ms', 'p99_ms'] as const;
const BASELINE_REVISION = '354da677b5';

function caseKey(...parts: (string | number)[]): string {
  return parts.join('|');
}

function layoutOf(row: Row): string {
  return caseKey(toInt(row.writers), toInt(row.channels));
}

function checkRow(row: Row): void {
  check(row.runtime === 'multi_thread_16' && row.profile === 'release', row);
  check(row.n === '2000', row);
  check(LAYOUTS.includes(layoutOf(row)), row);
  check(
    OPERATIONS.includes(row.operation) && VARIANTS.includes(row.variant),
    row
  );

  const quantiles = LATENCY.map((field) => toFloat(row[field]));
  check(allFinite(quantiles, 'positive'), row);
  check(isAscending(quantiles), row);

  const wall = toFloat(row.total_wall_ms);
  const rate = toFloat(row.throughput_ops_s);
  check(allFinite([wall, rate], 'positive'), row);
  check(ratesAgree(2_000_000 / wall, rate), row);
}

function sortKey(row: Row): (number | boolean)[] {
  return [
    toInt(row.run),
    LAYOUTS.indexOf(layoutOf(row)),
    OPERATIONS.indexOf(row.operation),
    row.variant !== 'before',
  ];
}

function readRows(paths: readonly string[]): Row[] {
  const rows: Row[] = [];
  const seen = new Set<string>();

  for (const path of paths) {
    for (const line of readLines(path)) {
      if (!line.startsWith('| multi_thread_16 |')) {
        continue;
      }

      const values = tableCells(line);
      check(values.length === FIELDS.length, path, line);
      const row = toRow(FIELDS, values);
      checkRow(row);

      const key = caseKey(
        toInt(row.run),
        layoutOf(row),
        row.operation,
        row.variant
      );
      check(!seen.has(key), 'duplicate result', key);
      seen.add(key);
      rows.push(row);
    }
  }

  const expected = new Set<string>();
  for (const run of [1, 2, 3]) {
    for (const layout of LAYOUTS) {
      for (const operation of OPERATIONS) {
        for (const variant of VARIANTS) {
          expected.add(caseKey(run, layout, operation, variant));
        }
      }
    }
  }
  check(sameKeys(seen, expected), 'incomplete or unexpected matrix', [...seen]);
  check(rows.length === 96);

  return rows.toSorted((left, right) =>
    compareKeys(sortKey(left), sortKey(right))
  );
}

function delta(old: number, current: number): string {
  const change = current - old;
  const percent = formatFixed((100 * change) / old, 1, 'always');
  return `${formatFixed(change, 3, 'always')} ms (${percent}%)`;
}

function main(): void {
  const { values, positionals: logs } = parseCommandLine(HELP, {
    'source-revision': { type: 'string' },
    output: { type: 'string' },
    implementation: { type: 'string', default: 'deadline' },
  });
  const sourceRevision = values['source-revision'];
  if (logs.length === 0 || sourceRevision === undefined) {
    const missing = missingArguments({
      logs: logs.length > 0,
      '--source-revision': sourceRevision !== undefined,
    });
    usageError(HELP, missing);
  }

  const kind = values.implementation;
  if (kind !== 'deadline' && kind !== 'admission') {
    usageError(
      HELP,
      `argument --implementation: invalid choice: '${kind}' (choose from deadline, admission)`
    );
  }

  const output = values.output ?? import.meta.dir;
  checkSourceRevision(sourceRevision);
  const rows = readRows(logs);
  writeRunsCsv(output, `channel_${kind}_write_latency_runs.csv`, FIELDS, rows);

  const groups = groupRows(rows, (row) =>
    caseKey(layoutOf(row), row.operation, row.variant)
  );

  function value(key: string, field: Field): number {
    return median(groupOf(groups, key).map((row) => toFloat(row[field])));
  }

  function latency(key: string): string {
    return LATENCY.map((field) => formatFixed(value(key, field), 3)).join(
      ' / '
    );
  }

  let title =
    '# Historical repository write latency with a total counter deadline';
  let implementation = [
    'The current channel path adds a preflight round trip before counter',
    'acquisition to set a total 50 ms statement deadline, preserving a',
    'stricter inherited deadline. The append restores the prior setting',
    'within its own statement.',
  ];
  if (kind === 'admission') {
    title = '# Repository write latency with per-parent admission';
    implementation = [
      'The current channel path admits at most four writers per parent in',
      'this process. Waiting for admission happens before pool acquisition',
      'and has a two-second bound. Idle gate entries are cleaned up. The',
      'database append retains a five-second lock-wait guard, with no',
      'new total statement deadline or preflight round trip.',
    ];
  }

  const lines = [
    title,
    '',
    `The tested implementation source is \`${sourceRevision}\`.`,
    `The old repository is pinned to \`${BASELINE_REVISION}\`, including its SQL,`,
    'hydration and transaction boundaries.',
    ...implementation,
    'These numbers compare full repository implementations; their difference',
    'does not isolate the cost of any one mechanism.',
    '',
    'Release profile, sixteen Tokio workers, one dedicated local PostgreSQL',
    '18.4 server with files on tmpfs, fsync and synchronous_commit enabled.',
    'Both variants use the same database. The pool permits 32 connections;',
    "sixteen are opened before timing. This worktree's compiler, plans and",
    'other tests were idle during measurement; the host was shared with other',
    'worktrees. This is not an isolated-host or production-disk measurement.',
    '',
    'The complete matrix has 96 rows: three repetitions, four writer/channel',
    'layouts, four operations, and two repository variants. Every row contains',
    '2,000 successful writes after 128 unmeasured warmups. Setup, worker',
    'startup and cleanup are outside timing. This runner does not retry and',
    'fails on repository errors; it cannot discard failures and finish the',
    'matrix. The separate bounded and shared-pool runners retain error metrics.',
    '',
    'The tables show medians of the three per-run percentiles and throughputs,',
    'not percentiles of pooled samples. The CSV retains each run.',
    '',
    '## Full matrix',
    '',
    'All latency values are milliseconds, in p50 / p95 / p99 order.',
    '',
    '| Writers | Channels | Operation | Old latency ms | Current latency ms | Old writes/s | Current writes/s |',
    '| ---: | ---: | --- | ---: | ---: | ---: | ---: |',
  ];

  for (const layout of LAYOUTS) {
    for (const operation of OPERATIONS) {
      const old = caseKey(layout, operation, 'before');
      const current = caseKey(layout, operation, 'after');
      const oldRate = formatFixed(value(old, 'throughput_ops_s'), 1);
      const currentRate = formatFixed(value(current, 'throughput_ops_s'), 1);
      lines.push(
        `| ${layout.replace('|', ' | ')} | ${operation} | ${latency(old)} | ${latency(current)} | ` +
          `${oldRate} | ${currentRate} |`
      );
    }
  }

  lines.push(
    '',
    '## Single-writer change',
    '',
    'Each delta is current minus old, calculated from the medians shown above.',
    'Positive latency values mean slower writes; negative values mean faster',
    'writes. Percent changes use the old latency as the denominator.',
    '',
    '| Operation | p50 delta | p95 delta | p99 delta | Throughput delta |',
    '| --- | ---: | ---: | ---: | ---: |'
  );

  for (const operation of OPERATIONS) {
    const old = caseKey('1|1', operation, 'before');
    const current = caseKey('1|1', operation, 'after');
    const changes = LATENCY.map((field) =>
      delta(value(old, field), value(current, field))
    );
    const oldRate = value(old, 'throughput_ops_s');
    const rateChange = value(current, 'throughput_ops_s') - oldRate;
    const ratePercent = formatFixed((100 * rateChange) / oldRate, 1, 'always');
    const rateDelta = `${formatFixed(rateChange, 1, 'always')} writes/s (${ratePercent}%)`;
    lines.push(`| ${operation} | ${changes.join(' | ')} | ${rateDelta} |`);
  }

  lines.push(
    '',
    '## Every measured run',
    '',
    'Latency varies across repetitions on this shared host. Read these rows',
    'alongside the aggregate table before attributing a difference to the',
    'implementation. The signed deltas compare complete repository methods;',
    'they do not isolate admission or deadline costs or remove host variability.',
    '',
    '| Run | Writers | Channels | Operation | Variant | p50 / p95 / p99 ms | Writes/s |',
    '| ---: | ---: | ---: | --- | --- | ---: | ---: |'
  );

  for (const row of rows) {
    const recorded = LATENCY.map((field) => row[field]).join(' / ');
    lines.push(
      `| ${row.run} | ${row.writers} | ${row.channels} | ${row.operation} | ` +
        `${row.variant} | ${recorded} | ${row.throughput_ops_s} |`
    );
  }

  lines.push(
    '',
    'This report is separate from the historical pre-timeout tables in',
    '[channel_write_latency_results.md](channel_write_latency_results.md).',
    'See [README.md](README.md) for rerun commands.',
    ''
  );
  writeReport(output, `channel_${kind}_write_latency_results.md`, lines);
}

runProof(main);
