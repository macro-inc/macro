#!/usr/bin/env bun
// Validate and summarize the current-only below-ceiling write benchmark.
import {
  allFinite,
  check,
  checkSourceRevision,
  compareKeys,
  csvFields,
  formatFixed,
  groupRows,
  isAscending,
  median,
  missingArguments,
  parseCommandLine,
  ProofError,
  readLines,
  runProof,
  sortedDistinct,
  toFloat,
  toInt,
  toRow,
  usageError,
  writeReport,
  writeRunsCsv,
} from './proof_support';

const HELP = `usage: summarize_bounded_latency.ts [-h] [--output OUTPUT]
                                    --source-revision SOURCE_REVISION
                                    logs [logs ...]

Validate and summarize the current-only below-ceiling write benchmark.

positional arguments:
  logs

options:
  -h, --help            show this help message and exit
  --output OUTPUT
  --source-revision SOURCE_REVISION
                        exact tested deadline source, including any working-
                        tree qualifier
`;

const FIELDS = [
  'proof',
  'label',
  'runtime',
  'profile',
  'run',
  'phase',
  'mode',
  'variant',
  'writers',
  'channels',
  'offered_ops_s',
  'requested_hold_ms',
  'attempts',
  'successes',
  'errors',
  'pool_acquire_timeouts',
  'sqlstate_55P03',
  'sqlstate_57014',
  'sqlstate_40P01',
  'other_errors',
  'arrival_p50_ms',
  'arrival_p95_ms',
  'arrival_p99_ms',
  'success_arrival_p50_ms',
  'success_arrival_p95_ms',
  'success_arrival_p99_ms',
  'failed_arrival_p50_ms',
  'failed_arrival_p95_ms',
  'failed_arrival_p99_ms',
  'service_p50_ms',
  'service_p95_ms',
  'service_p99_ms',
  'actual_hold_p50_ms',
  'actual_hold_p95_ms',
  'actual_hold_p99_ms',
  'total_wall_ms',
  'attempt_ops_s',
  'success_ops_s',
] as const;
type Field = (typeof FIELDS)[number];
type Row = Record<Field, string>;

// Offered writes per second (`-` for closed loop) and requested hold.
const CASES = [
  ['-', '0.000'],
  ['1000', '0.000'],
  ['3000', '0.000'],
  ['20', '5.000'],
  ['50', '5.000'],
  ['100', '5.000'],
  ['200', '2.000'],
] as const;
const ERROR_FIELDS = [
  'pool_acquire_timeouts',
  'sqlstate_55P03',
  'sqlstate_57014',
  'sqlstate_40P01',
  'other_errors',
] as const;
const PERCENTILES = [50, 95, 99] as const;

// Each latency distribution and the count of samples it was taken from.
const SAMPLED = [
  ['arrival', 'attempts'],
  ['service', 'attempts'],
  ['success_arrival', 'successes'],
  ['actual_hold', 'successes'],
  ['failed_arrival', 'errors'],
] as const;
type Distribution = (typeof SAMPLED)[number][0];

function sum(rows: readonly Row[], field: Field): number {
  let total = 0;
  for (const row of rows) {
    total += toInt(row[field]);
  }
  return total;
}

function checkRow(row: Row): void {
  check(row.runtime === 'multi_thread_16' && row.profile === 'release', row);
  check(row.variant === 'after' && row.channels === '1', row);
  check(row.phase === 'warmup' || row.phase === 'measured', row);

  const warmup = row.phase === 'warmup';
  check(row.writers === (warmup ? '1' : '16'), row);
  check(row.attempts === (warmup ? '128' : '2000'), row);

  const errors = toInt(row.errors);
  check(toInt(row.attempts) === toInt(row.successes) + errors, row);
  check(errors === errorTotal(row), row);

  let expectedMode = 'sequential';
  if (!warmup) {
    expectedMode = row.offered_ops_s === '-' ? 'closed_loop' : 'open_loop';
  }
  check(row.mode === expectedMode, row);

  const known = CASES.some(
    ([rate, hold]) =>
      rate === row.offered_ops_s && hold === row.requested_hold_ms
  );
  check(known, row);

  for (const [prefix, count] of SAMPLED) {
    const samples = PERCENTILES.map((p) => row[`${prefix}_p${p}_ms`]);

    if (toInt(row[count]) === 0) {
      check(
        samples.every((sample) => sample === 'NA'),
        row
      );
    } else {
      const numbers = samples.map(toFloat);
      check(allFinite(numbers, 'non_negative'), row);
      check(isAscending(numbers), row);
    }
  }
}

function errorTotal(row: Row): number {
  let total = 0;
  for (const field of ERROR_FIELDS) {
    total += toInt(row[field]);
  }
  return total;
}

function sortKey(row: Row): (string | number | boolean)[] {
  return [
    row.label,
    toInt(row.run),
    toFloat(row.requested_hold_ms),
    row.offered_ops_s === '-' ? 0 : toInt(row.offered_ops_s),
    row.phase !== 'warmup',
  ];
}

function readRows(paths: readonly string[]): Row[] {
  const rows: Row[] = [];
  const seen = new Set<string>();

  for (const path of paths) {
    for (const line of readLines(path)) {
      if (!line.startsWith('bounded_latency,')) {
        continue;
      }

      const values = csvFields(line);
      check(values.length === FIELDS.length, path, line);
      const row = toRow(FIELDS, values);
      checkRow(row);

      const key = JSON.stringify([
        row.label,
        row.run,
        row.phase,
        row.offered_ops_s,
        row.requested_hold_ms,
      ]);
      check(!seen.has(key), 'duplicate case', key);
      seen.add(key);
      rows.push(row);
    }
  }

  const labels = sortedDistinct(rows.map((row) => row.label));
  check(labels.length > 0, 'no bounded_latency rows found');

  for (const label of labels) {
    for (const run of ['1', '2', '3']) {
      for (const phase of ['warmup', 'measured']) {
        for (const [rate, hold] of CASES) {
          const key = JSON.stringify([label, run, phase, rate, hold]);
          check(seen.has(key), 'incomplete comparison', label, key);
        }
      }
    }
  }
  check(rows.length === 42 * labels.length, rows.length);

  return rows.toSorted((left, right) =>
    compareKeys(sortKey(left), sortKey(right))
  );
}

function quantiles(row: Row, prefix: Distribution): string {
  return PERCENTILES.map((p) => row[`${prefix}_p${p}_ms`]).join(' / ');
}

function middle(group: readonly Row[], field: Field): string {
  const recorded = group
    .filter((row) => row[field] !== 'NA')
    .map((row) => toFloat(row[field]));
  return recorded.length > 0 ? formatFixed(median(recorded), 3) : 'NA';
}

function main(): void {
  const { values, positionals: logs } = parseCommandLine(HELP, {
    output: { type: 'string' },
    'source-revision': { type: 'string' },
  });
  const sourceRevision = values['source-revision'];
  if (logs.length === 0 || sourceRevision === undefined) {
    const missing = missingArguments({
      logs: logs.length > 0,
      '--source-revision': sourceRevision !== undefined,
    });
    usageError(HELP, missing);
  }

  const output = values.output ?? import.meta.dir;
  checkSourceRevision(sourceRevision);
  const rows = readRows(logs);
  writeRunsCsv(output, 'channel_bounded_latency_runs.csv', FIELDS, rows);

  const measured = rows.filter((row) => row.phase === 'measured');
  const warmups = rows.filter((row) => row.phase === 'warmup');
  const allErrors = sum(rows, 'errors');
  const measuredErrors = sum(measured, 'errors');
  const measuredCount = sum(measured, 'attempts').toLocaleString('en-US');
  const warmupCount = sum(warmups, 'attempts').toLocaleString('en-US');

  const lines = [
    '# Current-repository below-ceiling write results',
    '',
    `Tested deadline implementation source: \`${sourceRevision}\`.`,
    '',
    'Release build, sixteen Tokio workers and sixteen connections, one channel,',
    'three repetitions of 2,000 measured mixed writes per case (500 each of',
    'create, edit, react and delete). All connections are opened before timing.',
    'Each case first performs 128 separately reported sequential warmup writes.',
    'Fixture creation, warmup and cleanup are outside the measured batch.',
    '',
    'The `deadline50ms` label identifies a total 50 ms counter-allocation',
    'statement deadline, preserving a stricter inherited statement timeout.',
    'One preflight round trip sets it before counter acquisition; the append',
    'restores the prior setting in-statement. No-hold cases',
    'call the current repository directly. Delayed cases call the audited',
    'current-method copies with a requested 2 or 5 ms sleep after the final',
    'statement and before COMMIT. There are no automatic retries.',
    '',
    'Fixed arrivals retain their original timestamps independently of',
    'completion, including when they must queue for one of sixteen workers.',
    'Arrival latency includes scheduler lateness, admission and pool waits,',
    'repository execution and commit acknowledgement. Closed-loop latency',
    'starts at each repository call. Rates include draining all requests.',
    '',
    'Recorded environment: dedicated local PostgreSQL 18.4 with data on tmpfs,',
    "fsync and synchronous_commit enabled; this worktree's compiler, plan jobs",
    'and tests idle during timing. The host is shared with other worktrees.',
    'This synthetic hold is not a measurement of production commit latency.',
    '',
    `Measured requests: **${measuredCount}**. Warmup requests: **${warmupCount}**.`,
    `Measured errors: **${measuredErrors}**. Errors including warmup: **${allErrors}**.`,
    'The no-error criterion passes only when both totals are zero. Every',
    'failed attempt remains in the latency and error counts.',
    '',
    '## Per-run measurements',
    '',
    '| Label | Run | Hold ms | Mode / offered writes/s | Successes / attempts | Errors | Arrival p50 / p95 / p99 ms | Failed p50 / p95 / p99 ms | Successful writes/s | Actual hold p50 / p95 / p99 ms |',
    '| --- | ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: |',
  ];

  for (const row of measured) {
    lines.push(
      `| ${row.label} | ${row.run} | ${row.requested_hold_ms} | ` +
        `${row.mode} / ${row.offered_ops_s} | ${row.successes} / ${row.attempts} | ` +
        `${row.errors} | ${quantiles(row, 'arrival')} | ${quantiles(row, 'failed_arrival')} | ` +
        `${row.success_ops_s} | ${quantiles(row, 'actual_hold')} |`
    );
  }

  const groups = groupRows(measured, (row) =>
    JSON.stringify([
      row.label,
      row.requested_hold_ms,
      row.mode,
      row.offered_ops_s,
    ])
  );

  lines.push(
    '',
    '## Three-run comparison',
    '',
    'Latency and rate values are medians of per-run values, not percentiles',
    'from pooled samples. Error counts are totals across all three runs.',
    '',
    '| Label | Hold ms | Mode / offered writes/s | Errors | Arrival p50 / p95 / p99 ms | Successful writes/s |',
    '| --- | ---: | --- | ---: | ---: | ---: |'
  );

  for (const group of groups.values()) {
    const first = group[0];
    if (!first) {
      continue;
    }

    const latency = PERCENTILES.map((p) =>
      middle(group, `arrival_p${p}_ms`)
    ).join(' / ');
    lines.push(
      `| ${first.label} | ${first.requested_hold_ms} | ${first.mode} / ${first.offered_ops_s} | ` +
        `${sum(group, 'errors')} | ${latency} | ${middle(group, 'success_ops_s')} |`
    );
  }

  lines.push(
    '',
    '## Errors, including warmup',
    '',
    '`55P03` includes both `Repository` and `Contended` errors; `57014` means',
    'query cancellation, `40P01` deadlock. The CSV retains successful-only',
    'arrival, all-attempt service latency, and every raw error category.',
    '',
    '| Label | Run | Phase | Hold ms | Offered writes/s | Pool timeout | 55P03 | 57014 | 40P01 | Other |',
    '| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |'
  );

  const errorColumns = [
    'label',
    'run',
    'phase',
    'requested_hold_ms',
    'offered_ops_s',
    ...ERROR_FIELDS,
  ] as const;
  for (const row of rows) {
    const cells = errorColumns.map((field) => row[field]);
    lines.push(`| ${cells.join(' | ')} |`);
  }

  lines.push(
    '',
    'See [README.md](README.md) for the benchmark and parser commands.',
    ''
  );
  writeReport(output, 'channel_bounded_latency_results.md', lines);

  if (allErrors > 0) {
    throw new ProofError(
      'below-ceiling requests failed; report and CSV were written'
    );
  }
}

runProof(main);
