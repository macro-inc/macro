#!/usr/bin/env bun
// Validate and summarize complete shared-pool isolation benchmark logs.
import {
  allFinite,
  check,
  compareKeys,
  csvFields,
  divide,
  formatFixed,
  groupRows,
  isAscending,
  median,
  missingArguments,
  parseCommandLine,
  readLines,
  runProof,
  sameKeys,
  sortedDistinct,
  toFloat,
  toInt,
  toRow,
  usageError,
  writeReport,
  writeRunsCsv,
} from './proof_support';

const HELP = `usage: summarize_pool_isolation.ts [-h] [--output OUTPUT]
                                   [--expected-seconds EXPECTED_SECONDS]
                                   [--partial-counterexample]
                                   logs [logs ...]

Validate and summarize complete shared-pool isolation benchmark logs.

positional arguments:
  logs

options:
  -h, --help            show this help message and exit
  --output OUTPUT
  --expected-seconds EXPECTED_SECONDS
  --partial-counterexample
                        retain the incomplete bounded50ms run separately,
                        without a three-run summary
`;

const OLD_FIELDS = [
  'proof',
  'label',
  'runtime',
  'profile',
  'run',
  'variant',
  'lane',
  'flood_writers',
  'offered_ops_s',
  'pool_min',
  'pool_max',
  'acquire_timeout_ms',
  'pool_size_at_start',
  'measured_seconds',
  'wall_with_drain_seconds',
  'attempts',
  'successes',
  'errors',
  'pool_acquire_timeouts',
  'sqlstate_55P03',
  'sqlstate_57014',
  'sqlstate_40P01',
  'other_errors',
  'attempt_p50_ms',
  'attempt_p95_ms',
  'attempt_p99_ms',
  'success_p50_ms',
  'success_p95_ms',
  'success_p99_ms',
  'requested_hold_ms',
  'success_hold_p50_ms',
  'success_hold_p95_ms',
  'success_hold_p99_ms',
  'success_ops_s',
] as const;
const FAILED_FIELDS = [
  'failed_p50_ms',
  'failed_p95_ms',
  'failed_p99_ms',
] as const;
const FIELDS = [...OLD_FIELDS, ...FAILED_FIELDS] as const;
type Field = (typeof FIELDS)[number];
type Row = Record<Field, string>;

const ERROR_FIELDS = [
  'pool_acquire_timeouts',
  'sqlstate_55P03',
  'sqlstate_57014',
  'sqlstate_40P01',
  'other_errors',
] as const;
const PERCENTILES = [50, 95, 99] as const;
const VARIANTS = ['before', 'after'];
const LANES = ['flood', 'probe'];

// Each latency distribution and the count of samples it was taken from.
const SAMPLED = [
  ['attempt', 'attempts'],
  ['success', 'successes'],
  ['success_hold', 'successes'],
  ['failed', 'errors'],
] as const;
type Distribution = (typeof SAMPLED)[number][0];

const KNOWN_SOURCES = new Map([
  [
    'baseline',
    'Pre-timeout implementation at `5743b47a10`, plus the shared-pool ' +
      'benchmark harness.',
  ],
  [
    'bounded5ms',
    'Implementation with the transaction-local 5 ms counter lock-wait ' +
      'timeout, retaining any stricter nonzero inherited timeout.',
  ],
  [
    'bounded50ms',
    'Discarded per-lock 50 ms timeout; consecutive transaction-id lock ' +
      'waits can exceed 50 ms in total. This did not isolate the shared pool.',
  ],
  [
    'deadline50ms',
    'Source `70d9301ff9ed571d2c849624f02a2c4f9fc60802`: total 50 ms ' +
      'counter-allocation statement deadline, preserving a ' +
      'stricter inherited statement timeout. One preflight round trip sets ' +
      'the deadline before allocation; the append restores it in-statement.',
  ],
]);

// Run and failed flood requests of the recorded final deadline runs.
const RECORDED_DEADLINE_ERRORS = ['1|28187', '2|28364', '3|28321'];

function caseKey(...parts: string[]): string {
  return JSON.stringify(parts);
}

function sum(rows: readonly Row[], field: Field): number {
  let total = 0;
  for (const row of rows) {
    total += toInt(row[field]);
  }
  return total;
}

function checkRow(row: Row, legacy: boolean, expectedSeconds: number): void {
  check(row.runtime === 'multi_thread_16', row);
  check(row.profile === 'release', row);
  check(row.pool_min === '10' && row.pool_max === '50', row);
  check(row.pool_size_at_start === '50', row);
  check(row.acquire_timeout_ms === '30000', row);
  check(row.flood_writers === '100', row);
  check(row.requested_hold_ms === '5', row);
  check(toFloat(row.measured_seconds) === expectedSeconds, row);

  const attempts = toInt(row.attempts);
  const errors = toInt(row.errors);
  check(attempts === toInt(row.successes) + errors, row);

  let categorized = 0;
  for (const field of ERROR_FIELDS) {
    categorized += toInt(row[field]);
  }
  check(errors === categorized, row);

  for (const [prefix, count] of SAMPLED) {
    if (prefix === 'failed' && legacy) {
      continue;
    }

    const samples = PERCENTILES.map((p) => row[`${prefix}_p${p}_ms`]);

    if (toInt(row[count]) === 0) {
      check(
        samples.every((sample) => sample === 'NA'),
        row
      );
    } else {
      const valuesMs = samples.map(toFloat);
      check(allFinite(valuesMs, 'non_negative'), row);
      check(isAscending(valuesMs), row);
    }
  }

  if (row.lane === 'probe') {
    check(attempts === expectedSeconds * 5, row);
    check(row.offered_ops_s === '5', row);
  } else {
    check(row.lane === 'flood' && row.offered_ops_s === 'closed_loop', row);
  }
}

function sortKey(row: Row): (string | number | boolean)[] {
  return [
    row.label,
    toInt(row.run),
    row.variant !== 'before',
    row.lane !== 'probe',
  ];
}

function readRows(
  paths: readonly string[],
  expectedSeconds: number,
  partialCounterexample: boolean
): Row[] {
  const rows: Row[] = [];
  const seen = new Set<string>();

  for (const path of paths) {
    for (const line of readLines(path)) {
      if (!line.startsWith('pool_isolation,')) {
        continue;
      }

      // Logs from before failed-attempt latency was recorded have 34 columns.
      const values = csvFields(line);
      const legacy = values.length === OLD_FIELDS.length;
      check(legacy || values.length === FIELDS.length, path, line);
      if (legacy) {
        values.push('NA', 'NA', 'NA');
      }

      const row = toRow(FIELDS, values);
      checkRow(row, legacy, expectedSeconds);

      const key = caseKey(row.label, row.run, row.variant, row.lane);
      check(!seen.has(key), 'duplicate case', key);
      seen.add(key);
      rows.push(row);
    }
  }

  const labels = sortedDistinct(rows.map((row) => row.label));
  check(labels.length > 0, 'no pool_isolation CSV rows found');

  for (const label of labels) {
    if (partialCounterexample) {
      check(
        labels.length === 1 && label === 'bounded50ms',
        'partial mode is reserved for the discarded per-lock counterexample'
      );

      // Three old-method runs and the two current-method runs that finished.
      const completed = new Set<string>();
      for (const [variant, runs] of [
        ['before', ['1', '2', '3']],
        ['after', ['1', '2']],
      ] as const) {
        for (const run of runs) {
          for (const lane of LANES) {
            completed.add(caseKey(label, run, variant, lane));
          }
        }
      }
      check(
        sameKeys(seen, completed),
        'expected three old and two current completed cases',
        [...seen]
      );
      continue;
    }

    for (const run of ['1', '2', '3']) {
      for (const variant of VARIANTS) {
        for (const lane of LANES) {
          const key = caseKey(label, run, variant, lane);
          check(seen.has(key), 'incomplete three-run comparison', label, key);
        }
      }
    }
  }

  if (!partialCounterexample) {
    check(rows.length === labels.length * 12, 'unexpected cases', rows.length);
  }

  return rows.toSorted((left, right) =>
    compareKeys(sortKey(left), sortKey(right))
  );
}

function quantiles(row: Row, prefix: Distribution): string {
  return PERCENTILES.map((p) => row[`${prefix}_p${p}_ms`]).join(' / ');
}

function failedPercent(errors: number, attempts: number): string {
  return `${formatFixed(divide(100 * errors, attempts), 2)}%`;
}

function sourceContext(rows: readonly Row[]): string[] {
  const labels = sortedDistinct(rows.map((row) => row.label));
  const lines = [
    '## Source and environment',
    '',
    'The `before` variant always uses the old repository methods pinned to',
    '`354da677b5`, including their original hydration path. The `after`',
    'variant uses the source state identified by its label:',
    '',
    '| Label | Current-method source |',
    '| --- | --- |',
  ];

  for (const label of labels) {
    const source =
      KNOWN_SOURCES.get(label) ?? 'Source state not recorded by this parser.';
    lines.push(`| ${label} | ${source} |`);
  }

  lines.push(
    '',
    'The benchmark-only method copies preserve the ordered SQL and add only',
    'the measured sleep and returned duration; verify them with',
    '[the source-equivalence audit](check_delayed_writers.ts). Requests call',
    'the repository directly and have no automatic retries. Each error is',
    'one failed request, not a successfully retried operation.',
    '',
    'Pool sizing copies the production branch in',
    '[the document storage server](../../../services/document_storage_service/src/server.rs#L245):',
    "minimum 10, maximum 50, with SQLx's default 30-second acquire timeout.",
    'The recorded benchmark settings are checked against those values.',
    ''
  );

  if (labels.some((label) => KNOWN_SOURCES.has(label))) {
    lines.push(
      'Recorded environment for the `baseline`, `bounded5ms`, `bounded50ms` and `deadline50ms` measurements:',
      'a dedicated local PostgreSQL 18.4 server with data files on tmpfs,',
      "`fsync` and `synchronous_commit` enabled. This worktree's compiler,",
      'query-plan jobs and tests were idle during the timed work. The host',
      'was shared with other worktrees; this was not an isolated-host or',
      'production-disk measurement. These facts are recorded context, not',
      'settings inferred by the parser from the CSV.',
      ''
    );
  }

  // This server-log cross-check belongs to these recorded runs, not any
  // future invocation that happens to reuse the same descriptive label.
  const deadline = new Set<string>();
  for (const row of rows) {
    const finalFlood =
      row.label === 'deadline50ms' &&
      row.variant === 'after' &&
      row.lane === 'flood';
    if (finalFlood) {
      deadline.add(`${row.run}|${row.errors}`);
    }
  }

  if (sameKeys(deadline, new Set(RECORDED_DEADLINE_ERRORS))) {
    lines.push(
      'The dedicated server log `/tmp/channel-seq-pg.log` was cross-checked',
      'for 2026-11-12 07:06:00–07:09:59 UTC, inclusive. That window contains',
      'exactly 84,872 `canceling statement due to statement timeout` errors',
      'and zero `canceling statement due to user request` errors. This',
      'matches all 84,872 failed flood requests in the three final deadline',
      'runs. The evidence applies to these runs and this window only.',
      'Those statement-timeout messages match the recognized contention',
      'classification in the message repository, whose HTTP adapter maps',
      'it to 503 with `Retry-After: 1`. The benchmark calls the repository',
      'directly; it does not itself measure HTTP responses. See the',
      '[transaction audit](channel_transaction_audit.md#caller-visible-failures-and-rollback).',
      ''
    );
  }

  return lines;
}

function middle(group: readonly Row[], field: Field): string {
  const recorded = group
    .filter((row) => row[field] !== 'NA')
    .map((row) => toFloat(row[field]));
  return recorded.length > 0 ? formatFixed(median(recorded), 3) : 'NA';
}

function middleQuantiles(group: readonly Row[], prefix: Distribution): string {
  return PERCENTILES.map((p) => middle(group, `${prefix}_p${p}_ms`)).join(
    ' / '
  );
}

// The columns both three-run tables share after their first measurement.
function comparisonCells(group: readonly Row[]): string {
  const errors = sum(group, 'errors');
  return (
    `${middleQuantiles(group, 'attempt')} | ${errors} / ` +
    `${sum(group, 'pool_acquire_timeouts')} / ${sum(group, 'sqlstate_55P03')} | ` +
    `${failedPercent(errors, sum(group, 'attempts'))} | ` +
    `${middleQuantiles(group, 'failed')} | ${middleQuantiles(group, 'success_hold')} |`
  );
}

function main(): void {
  const { values, positionals: logs } = parseCommandLine(HELP, {
    output: { type: 'string' },
    'expected-seconds': { type: 'string', default: '30' },
    'partial-counterexample': { type: 'boolean', default: false },
  });
  if (logs.length === 0) {
    usageError(HELP, missingArguments({ logs: false }));
  }
  if (!/^\s*[+-]?\d+(_\d+)*\s*$/.test(values['expected-seconds'])) {
    usageError(
      HELP,
      `argument --expected-seconds: invalid int value: '${values['expected-seconds']}'`
    );
  }

  const output = values.output ?? import.meta.dir;
  const expectedSeconds = toInt(values['expected-seconds']);
  const partial = values['partial-counterexample'];
  check(expectedSeconds > 0, 'expected seconds must be positive');
  const rows = readRows(logs, expectedSeconds, partial);
  const stem = partial
    ? 'channel_pool_isolation_bounded50ms_partial'
    : 'channel_pool_isolation';
  writeRunsCsv(output, `${stem}_runs.csv`, FIELDS, rows);

  const lines = ['# Shared-pool channel isolation results', ''];

  if (partial) {
    const probes = rows.filter(
      (row) => row.variant === 'after' && row.lane === 'probe'
    );
    const probeP95 = probes.map((row) => row.attempt_p95_ms).join(' / ');
    lines.push(
      '**Incomplete counterexample, not the required three-run proof.**',
      'This per-lock timeout experiment was stopped after three old-method',
      'cases and two new-method cases. The rows below are only the completed',
      'cases. There is no third new-method result or three-run aggregate.',
      '',
      `The completed new-method probe runs had p95 **${probeP95} ms** and`,
      `**${sum(probes, 'errors')} errors** across ${sum(probes, 'attempts')} probes.`,
      'The absence of errors did not establish latency isolation: a per-lock',
      'timeout can restart across successive transaction-id lock waits.',
      'This counterexample motivated the total statement deadline.',
      ''
    );
  }

  lines.push(
    ...sourceContext(rows),
    '## Workload',
    '',
    'Release build with sixteen Tokio workers, a shared pool of 10 minimum /',
    '50 maximum connections, and the default 30-second acquire timeout.',
    'All 50 connections were opened before measurement. One hundred writers',
    'each edit a distinct message in the flood channel; independent probes',
    'edit distinct messages in a second channel at five scheduled arrivals',
    'per second. Both repository variants receive a requested 5 ms sleep',
    'after their last SQL statement and before COMMIT. The current variant',
    'holds its channel counter during this artificial interval.',
    '',
    `Each case admits work for ${expectedSeconds} seconds and retains all`,
    `${expectedSeconds * 5} scheduled probes. Probe latency starts at the`,
    'original scheduled arrival and includes pool waits; flood latency starts',
    'at each repository call. No semaphore precedes the pool. Throughput',
    'includes draining in-flight work. Setup and cleanup are not timed.',
    '',
    'Each row below is one run, not an aggregate of percentiles. Attempt',
    'latency includes failed writes. Successful-write latency and observed',
    'sleep duration exclude errors; NA means there were no successful writes.',
    'The sleep is a controlled stress input, not a measured production commit',
    'latency. A failed attempt includes any pool-acquisition wait and other',
    'repository work before the counter-allocation statement deadline; its',
    'end-to-end duration can therefore exceed that 50 ms statement budget.',
    '',
    '| Label | Run | Variant | Lane | Attempts / successes | Attempt p50 / p95 / p99 ms | Success p50 / p95 / p99 ms | Successes/s | Observed 5 ms hold p50 / p95 / p99 ms |',
    '| --- | ---: | --- | --- | ---: | ---: | ---: | ---: | ---: |'
  );

  for (const row of rows) {
    lines.push(
      `| ${row.label} | ${row.run} | ${row.variant} | ${row.lane} | ` +
        `${row.attempts} / ${row.successes} | ${quantiles(row, 'attempt')} | ` +
        `${quantiles(row, 'success')} | ${row.success_ops_s} | ` +
        `${quantiles(row, 'success_hold')} |`
    );
  }

  const groups = groupRows(rows, (row) =>
    caseKey(row.label, row.variant, row.lane)
  );

  if (!partial) {
    lines.push(
      '',
      '## Three-run comparison',
      '',
      'Latency and rate columns below are medians of the three per-run values,',
      'not percentiles calculated from pooled samples. Error columns are sums',
      'over all three runs. Failure percentages use total errors divided by',
      'total attempts. The per-run tables retain tail variation.',
      '',
      '| Label | Variant | Probe attempts | Probe p50 / p95 / p99 ms | Probe errors / pool timeouts / 55P03 | Failed % | Failed p50 / p95 / p99 ms | Probe observed hold p50 / p95 / p99 ms |',
      '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |'
    );

    for (const group of groups.values()) {
      const first = group[0];
      if (first?.lane === 'probe') {
        lines.push(
          `| ${first.label} | ${first.variant} | ${sum(group, 'attempts')} | ` +
            comparisonCells(group)
        );
      }
    }

    lines.push(
      '',
      '| Label | Variant | Flood successes/s | Flood p50 / p95 / p99 ms | Flood errors / pool timeouts / 55P03 | Failed % | Failed p50 / p95 / p99 ms | Flood observed hold p50 / p95 / p99 ms |',
      '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |'
    );

    for (const group of groups.values()) {
      const first = group[0];
      if (first?.lane === 'flood') {
        lines.push(
          `| ${first.label} | ${first.variant} | ${middle(group, 'success_ops_s')} | ` +
            comparisonCells(group)
        );
      }
    }
  }

  lines.push(
    '',
    '## Errors',
    '',
    'The `55P03` count includes the preserved SQLSTATE in both',
    '`MessageError::Repository` and `MessageError::Contended`. The classifier',
    'likewise counts underlying `57014` statement cancellations separately;',
    'the domain variant does not hide the original PostgreSQL error code.',
    'Failed-attempt latency is retained separately from successful writes.',
    'Legacy 34-column logs have no failed-latency samples and show `NA` for',
    'that field, even if they contain failures. Current logs have 37 columns.',
    'A failure percentage is calculated from errors divided by all attempts;',
    'it does not discard failed requests from the denominator.',
    'These direct repository measurements do not exercise HTTP responses;',
    'the 503 and `Retry-After: 1` mapping is described separately in the',
    '[transaction and timeout audit](channel_transaction_audit.md#caller-visible-failures-and-rollback).',
    '',
    '| Label | Run | Variant | Lane | All errors | Failed % | Failed p50 / p95 / p99 ms | Pool acquire timeout | 55P03 | 57014 | 40P01 | Other |',
    '| --- | ---: | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |'
  );

  for (const row of rows) {
    const cells = [
      row.label,
      row.run,
      row.variant,
      row.lane,
      row.errors,
      failedPercent(toInt(row.errors), toInt(row.attempts)),
      quantiles(row, 'failed'),
      ...ERROR_FIELDS.map((field) => row[field]),
    ];
    lines.push(`| ${cells.join(' | ')} |`);
  }

  lines.push(
    '',
    'The CSV retains pool settings, full wall time and all per-run fields.',
    'Reproduce the benchmark and parsing commands in [README.md](README.md).',
    ''
  );
  writeReport(output, `${stem}_results.md`, lines);
}

runProof(main);
