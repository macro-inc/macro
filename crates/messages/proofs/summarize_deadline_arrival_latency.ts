#!/usr/bin/env bun
// Validate the final no-hold fixed-arrival comparison without replacing
// historical results.
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

const HELP = `usage: summarize_deadline_arrival_latency.ts [-h]
                                             --source-revision SOURCE_REVISION
                                             [--output OUTPUT]
                                             [--implementation {deadline,admission}]
                                             logs [logs ...]

Validate the final no-hold fixed-arrival comparison without replacing
historical results.

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
  'mode',
  'run',
  'connections',
  'channels',
  'offered_ops_s',
  'variant',
  'n',
  'arrival_p50_ms',
  'arrival_p95_ms',
  'arrival_p99_ms',
  'service_p50_ms',
  'service_p95_ms',
  'service_p99_ms',
  'requested_hold_ms',
  'actual_hold_p50_ms',
  'actual_hold_p95_ms',
  'actual_hold_p99_ms',
  'total_wall_ms',
  'achieved_ops_s',
] as const;
type Field = (typeof FIELDS)[number];
type Row = Record<Field, string>;

const CHANNELS = [1, 16];
const RATES = [50, 200, 1000, 3000];
const VARIANTS = ['before', 'after'];
const PERCENTILES = [50, 95, 99] as const;

function caseKey(...parts: (string | number)[]): string {
  return parts.join('|');
}

function checkRow(row: Row): void {
  check(row.runtime === 'multi_thread_16' && row.profile === 'release', row);
  check(row.mode === 'open_loop' && row.connections === '16', row);
  check(
    CHANNELS.includes(toInt(row.channels)) &&
      RATES.includes(toInt(row.offered_ops_s)),
    row
  );
  check(VARIANTS.includes(row.variant) && row.n === '2000', row);
  check(toFloat(row.requested_hold_ms) === 0, row);
  check(
    PERCENTILES.every((p) => toFloat(row[`actual_hold_p${p}_ms`]) === 0),
    row
  );

  for (const prefix of ['arrival', 'service'] as const) {
    const quantiles = PERCENTILES.map((p) =>
      toFloat(row[`${prefix}_p${p}_ms`])
    );
    check(allFinite(quantiles, 'positive'), row);
    check(isAscending(quantiles), row);
  }

  const wall = toFloat(row.total_wall_ms);
  const rate = toFloat(row.achieved_ops_s);
  check(allFinite([wall, rate], 'positive'), row);
  check(ratesAgree(2_000_000 / wall, rate), row);
}

function sortKey(row: Row): (number | boolean)[] {
  return [
    toInt(row.run),
    toInt(row.channels),
    toInt(row.offered_ops_s),
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
        toInt(row.channels),
        toInt(row.offered_ops_s),
        row.variant
      );
      check(!seen.has(key), 'duplicate result', key);
      seen.add(key);
      rows.push(row);
    }
  }

  const expected = new Set<string>();
  for (const run of [1, 2, 3]) {
    for (const channels of CHANNELS) {
      for (const rate of RATES) {
        for (const variant of VARIANTS) {
          expected.add(caseKey(run, channels, rate, variant));
        }
      }
    }
  }
  check(sameKeys(seen, expected), 'incomplete or unexpected comparison', [
    ...seen,
  ]);
  check(rows.length === 48);

  return rows.toSorted((left, right) =>
    compareKeys(sortKey(left), sortKey(right))
  );
}

function runLine(row: Row): string {
  const latency = PERCENTILES.map((p) => row[`arrival_p${p}_ms`]).join(' / ');
  return (
    `| ${row.run} | ${row.channels} | ${row.offered_ops_s} | ` +
    `${row.variant} | ${latency} | ${row.achieved_ops_s} |`
  );
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
  writeRunsCsv(output, `channel_${kind}_arrival_latency_runs.csv`, FIELDS, rows);

  const groups = groupRows(rows, (row) =>
    caseKey(toInt(row.channels), toInt(row.offered_ops_s), row.variant)
  );

  function value(key: string, field: Field): number {
    return median(groupOf(groups, key).map((row) => toFloat(row[field])));
  }

  function latency(key: string): string {
    return PERCENTILES.map((p) =>
      formatFixed(value(key, `arrival_p${p}_ms`), 3)
    ).join(' / ');
  }

  let title = '# Historical fixed-arrival writes with a total counter deadline';
  let implementation = [
    'The current path sets a total 50 ms counter-allocation statement',
    'deadline, preserving a stricter inherited deadline, in one round trip',
    'before acquiring the counter. The append restores the prior setting',
    'within its statement.',
  ];
  if (kind === 'admission') {
    title = '# Fixed-arrival writes with per-parent admission';
    implementation = [
      'The current process admits at most four writes per parent. Its',
      'two-second wait happens before pool acquisition, and idle entries',
      'are cleaned up. The append has a five-second database lock-wait',
      'guard, with no total statement deadline or preflight round trip.',
    ];
  }

  const lines = [
    title,
    '',
    `The tested implementation source is \`${sourceRevision}\`.`,
    'The old repository retains the methods, SQL and hydration pinned to',
    '`354da677b5`.',
    ...implementation,
    'Both variants are measured without an artificial hold. The comparison',
    'includes the complete repository change, not the isolated cost of one',
    'mechanism.',
    '',
    'Release profile, sixteen Tokio workers and sixteen database connections.',
    'One dedicated local PostgreSQL 18.4 server with files on tmpfs, fsync and',
    "synchronous_commit enabled. This worktree's compiler, plan jobs and tests",
    'were idle during measurement; other worktrees shared the host. This is',
    'not an isolated-host or production-disk measurement.',
    '',
    'Each of 48 cases has 2,000 mixed writes, 500 each of create, edit, react',
    'and delete, following 128 unmeasured warmups. Three repetitions compare',
    'old/current implementations at 50, 200, 1,000 and 3,000 total arrivals/s',
    'in one and sixteen channels. Operations rotate independently through',
    'channels. Fixture creation, warmup and cleanup are outside measurement.',
    '',
    'The scheduler retains every original arrival timestamp and runs',
    'independently of completions. Requests queue for one of sixteen workers.',
    'Arrival latency includes scheduler lateness, admission, pool and counter',
    'waits, SQL and commit acknowledgement. Achieved rate includes draining',
    'the final requests. The runner does not retry; repository errors abort',
    'the test, so a full successful matrix cannot silently discard failures.',
    '',
    '## Three-run comparison',
    '',
    'All latency values are milliseconds in p50 / p95 / p99 order. Values',
    'are medians of the three per-run percentiles and achieved rates, not',
    'percentiles from pooled samples. Every run is retained below and in CSV.',
    '',
    '| Channels | Offered writes/s | Old latency ms | Current latency ms | Old achieved writes/s | Current achieved writes/s |',
    '| ---: | ---: | ---: | ---: | ---: | ---: |',
  ];

  for (const channels of CHANNELS) {
    for (const rate of RATES) {
      const old = caseKey(channels, rate, 'before');
      const current = caseKey(channels, rate, 'after');
      const oldRate = formatFixed(value(old, 'achieved_ops_s'), 1);
      const currentRate = formatFixed(value(current, 'achieved_ops_s'), 1);
      lines.push(
        `| ${channels} | ${rate} | ${latency(old)} | ${latency(current)} | ` +
          `${oldRate} | ${currentRate} |`
      );
    }
  }

  lines.push(
    '',
    '## Every measured run',
    '',
    '| Run | Channels | Offered writes/s | Variant | Arrival p50 / p95 / p99 ms | Achieved writes/s |',
    '| ---: | ---: | ---: | --- | ---: | ---: |',
    ...rows.map(runLine),
    '',
    '## Individual-run tails',
    '',
    'Every run with p99 at least 10 ms is repeated below so medians do not',
    'hide large tails. These are per-run percentiles, not maximum request',
    'durations. The shared-host measurements do not identify their cause.',
    '',
    '| Run | Channels | Offered writes/s | Variant | p50 / p95 / p99 ms | Achieved writes/s |',
    '| ---: | ---: | ---: | --- | ---: | ---: |'
  );

  // Largest p99 first; runs with an equal p99 keep their order above.
  const largeTails = rows
    .filter((row) => toFloat(row.arrival_p99_ms) >= 10)
    .toSorted(
      (left, right) =>
        toFloat(right.arrival_p99_ms) - toFloat(left.arrival_p99_ms)
    );
  lines.push(...largeTails.map(runLine));
  if (largeTails.length === 0) {
    lines.push('No measured run had p99 at least 10 ms.');
  }

  lines.push(
    '',
    'The raw CSV also retains service latency, wall time and the verified',
    'zero requested/actual holds. Historical pre-timeout results remain in',
    '[channel_arrival_latency_results.md](channel_arrival_latency_results.md).',
    'See [README.md](README.md) for current and historical rerun instructions.',
    ''
  );
  writeReport(output, `channel_${kind}_arrival_latency_results.md`, lines);
}

runProof(main);
