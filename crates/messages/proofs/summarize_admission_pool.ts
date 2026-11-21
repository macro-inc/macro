#!/usr/bin/env bun
// Validate the fixed-arrival shared-pool admission proof and retain every run.
import {
  allFinite,
  check,
  checkSourceRevision,
  compareKeys,
  csvFields,
  divide,
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
  toFloat,
  toInt,
  toRow,
  usageError,
  writeReport,
  writeRunsCsv,
} from './proof_support';

const HELP = `usage: summarize_admission_pool.ts [-h] --source-revision SOURCE_REVISION
                                   [--output OUTPUT]
                                   logs [logs ...]

Validate the fixed-arrival shared-pool admission proof and retain every run.

positional arguments:
  logs

options:
  -h, --help            show this help message and exit
  --source-revision SOURCE_REVISION
  --output OUTPUT
`;

const FIELDS = [
  'proof',
  'label',
  'runtime',
  'profile',
  'run',
  'variant',
  'lane',
  'flood_rate',
  'offered_rate',
  'requested_hold_ms',
  'scheduled_seconds',
  'pool_min',
  'pool_max',
  'acquire_timeout_ms',
  'pool_size_at_start',
  'attempts',
  'admission_accepted',
  'admission_rejected',
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
  'success_p50_ms',
  'success_p95_ms',
  'success_p99_ms',
  'rejection_arrival_p50_ms',
  'rejection_arrival_p95_ms',
  'rejection_arrival_p99_ms',
  'rejection_service_p50_ms',
  'rejection_service_p95_ms',
  'rejection_service_p99_ms',
  'actual_hold_p50_ms',
  'actual_hold_p95_ms',
  'actual_hold_p99_ms',
  'lane_wall_ms',
  'successful_ops_s',
  'attempt_ops_s',
] as const;
type Field = (typeof FIELDS)[number];
type Row = Record<Field, string>;

const ERRORS = [
  'pool_acquire_timeouts',
  'sqlstate_55P03',
  'sqlstate_57014',
  'sqlstate_40P01',
  'other_errors',
] as const;
const PERCENTILES = [50, 95, 99] as const;
const FLOOD_RATES = ['1000', '3000'] as const;
const HOLDS = ['0.000', '2.000', '5.000'] as const;
const VARIANTS = ['before', 'after'] as const;
const LANES = ['flood', 'neighbor'] as const;

// Each latency distribution and the count of samples it was taken from.
const SAMPLED = [
  ['arrival', 'attempts'],
  ['success', 'successes'],
  ['rejection_arrival', 'admission_rejected'],
  ['rejection_service', 'admission_rejected'],
  ['actual_hold', 'successes'],
] as const;
type Distribution = (typeof SAMPLED)[number][0];

function includes(values: readonly string[], value: string): boolean {
  return values.includes(value);
}

function caseKey(...parts: string[]): string {
  return parts.join('|');
}

function checkRow(row: Row): void {
  check(row.runtime === 'multi_thread_16' && row.profile === 'release', row);
  check(row.pool_min === '10' && row.pool_max === '50', row);
  check(
    row.acquire_timeout_ms === '30000' && row.pool_size_at_start === '50',
    row
  );
  check(row.scheduled_seconds === '10', row);
  check(includes(FLOOD_RATES, row.flood_rate), row);
  check(includes(HOLDS, row.requested_hold_ms), row);
  check(includes(VARIANTS, row.variant) && includes(LANES, row.lane), row);

  const expectedRate = row.lane === 'flood' ? row.flood_rate : '20';
  const attempts = toInt(row.attempts);
  const rejected = toInt(row.admission_rejected);
  const errors = toInt(row.errors);
  check(row.offered_rate === expectedRate, row);
  check(attempts === toInt(expectedRate) * 10, row);
  check(attempts === toInt(row.admission_accepted) + rejected, row);
  check(attempts === toInt(row.successes) + errors, row);

  let databaseErrors = 0;
  for (const field of ERRORS) {
    databaseErrors += toInt(row[field]);
  }
  check(errors === rejected + databaseErrors, row);

  if (row.variant === 'before') {
    check(row.admission_rejected === '0', row);
  }

  for (const [prefix, count] of SAMPLED) {
    const samples = PERCENTILES.map((p) => row[`${prefix}_p${p}_ms`]);

    if (toInt(row[count]) === 0) {
      check(
        samples.every((sample) => sample === 'NA'),
        row
      );
    } else {
      const numeric = samples.map(toFloat);
      check(allFinite(numeric, 'non_negative'), row);
      check(isAscending(numeric), row);
    }
  }

  const wall = toFloat(row.lane_wall_ms);
  check(Number.isFinite(wall) && wall > 0, row);

  for (const [field, count] of [
    ['attempt_ops_s', 'attempts'],
    ['successful_ops_s', 'successes'],
  ] as const) {
    const rate = toFloat(row[field]);
    check(Number.isFinite(rate) && rate >= 0, row);
    check(ratesAgree(rate, (toInt(row[count]) * 1000) / wall), row);
  }
}

function readRows(paths: readonly string[]): Row[] {
  const rows: Row[] = [];
  const seen = new Set<string>();

  for (const path of paths) {
    for (const line of readLines(path)) {
      if (!line.startsWith('admission_pool,')) {
        continue;
      }

      const values = csvFields(line);
      check(values.length === FIELDS.length, path, line);
      const row = toRow(FIELDS, values);
      checkRow(row);

      const key = caseKey(
        row.run,
        row.flood_rate,
        row.requested_hold_ms,
        row.variant,
        row.lane
      );
      check(!seen.has(key), 'duplicate row', key);
      seen.add(key);
      rows.push(row);
    }
  }

  check(
    new Set(rows.map((row) => row.label)).size === 1,
    'one source label per report'
  );

  const expected = new Set<string>();
  for (const run of ['1', '2', '3']) {
    for (const rate of FLOOD_RATES) {
      for (const hold of HOLDS) {
        for (const variant of VARIANTS) {
          for (const lane of LANES) {
            expected.add(caseKey(run, rate, hold, variant, lane));
          }
        }
      }
    }
  }
  check(sameKeys(seen, expected), 'incomplete or unexpected case set', [
    ...seen,
  ]);
  check(rows.length === 72);

  return rows.toSorted((left, right) =>
    compareKeys(sortKey(left), sortKey(right))
  );
}

function sortKey(row: Row): (number | boolean)[] {
  return [
    toInt(row.run),
    toInt(row.flood_rate),
    toFloat(row.requested_hold_ms),
    row.variant !== 'before',
    row.lane !== 'neighbor',
  ];
}

function main(): void {
  const { values, positionals: logs } = parseCommandLine(HELP, {
    'source-revision': { type: 'string' },
    output: { type: 'string' },
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
  writeRunsCsv(output, 'channel_admission_pool_runs.csv', FIELDS, rows);

  const groups = groupRows(rows, (row) =>
    caseKey(row.flood_rate, row.requested_hold_ms, row.variant, row.lane)
  );

  function total(key: string, field: Field): number {
    let sum = 0;
    for (const row of groupOf(groups, key)) {
      sum += toInt(row[field]);
    }
    return sum;
  }

  function mid(key: string, field: Field): string {
    const recorded = groupOf(groups, key)
      .filter((row) => row[field] !== 'NA')
      .map((row) => toFloat(row[field]));
    return recorded.length > 0 ? formatFixed(median(recorded), 3) : 'NA';
  }

  function quantiles(key: string, prefix: Distribution): string {
    return PERCENTILES.map((p) => mid(key, `${prefix}_p${p}_ms`)).join(' / ');
  }

  function percentage(key: string): number {
    return divide(100 * total(key, 'admission_rejected'), total(key, 'attempts'));
  }

  const lines = [
    '# Fixed-arrival admission and shared-pool isolation',
    '',
    `Tested implementation source: \`${sourceRevision}\`.`,
    'The old methods are pinned to `354da677b5`. The current process admits',
    'four writes per parent and bounds admission waiting to two seconds,',
    'before pool acquisition. Idle entries are cleaned up. The database',
    'append retains a five-second lock-wait guard. The old methods bypass',
    'admission; their SQL, hydration and transaction boundaries are unchanged.',
    '',
    'Release profile and sixteen Tokio workers, one pool configured with',
    'minimum 10 / maximum 50 connections and its default 30-second acquire',
    'timeout. All 50 connections are opened before measurement. Each case',
    'uses two channels: 1,000 or 3,000 fixed flood arrivals per second and',
    '20 fixed neighbor arrivals per second for ten seconds, with full drain.',
    'Each write edits a distinct preseeded row, so message-row contention',
    'does not substitute for contention on the parent. Fixtures and cleanup',
    'are outside the measurement. Three runs compare old and current methods',
    'with no synthetic hold, or a requested 2 / 5 ms hold before COMMIT.',
    '',
    'Both arrival schedulers preserve original timestamps, including late',
    'ticks. Every request is spawned independently: there is no external',
    'semaphore or completion-dependent arrival loop. Arrival latency includes',
    'scheduler delay, gate and pool waits, SQL and commit. Rejection service',
    'time starts at the repository call; rejection arrival time includes',
    "scheduler lateness too. Rates use each lane's own time through its last",
    'completion. No request is retried or dropped.',
    '',
    'Admission-accepted counts mean attempts without a typed AdmissionTimeout;',
    'they can include a subsequent database failure. Successful writes mean',
    'COMMIT returned successfully. Admission rejections, database SQLSTATEs',
    'and pool-acquisition timeouts are counted separately. Missing latency',
    'samples are NA. Medians below are medians of per-run percentiles/rates;',
    'counts and fractions aggregate the three complete runs. Every raw row',
    'is retained in CSV and every neighbor run appears below.',
    '',
    '## Neighbor comparison',
    '',
    'Each variant has 600 neighbor attempts per row (200 in each run).',
    'Latency columns are p50 / p95 / p99 in milliseconds.',
    '',
    '| Flood/s | Hold ms | Old neighbor latency | Current neighbor latency | Old/current neighbor errors | Old/current pool timeouts |',
    '| ---: | ---: | ---: | ---: | ---: | ---: |',
  ];

  for (const rate of FLOOD_RATES) {
    for (const hold of HOLDS) {
      const old = caseKey(rate, hold, 'before', 'neighbor');
      const current = caseKey(rate, hold, 'after', 'neighbor');
      lines.push(
        `| ${rate} | ${hold} | ${quantiles(old, 'arrival')} | ${quantiles(current, 'arrival')} | ` +
          `${total(old, 'errors')} / ${total(current, 'errors')} | ` +
          `${total(old, 'pool_acquire_timeouts')} / ${total(current, 'pool_acquire_timeouts')} |`
      );
    }
  }

  lines.push(
    '',
    '## Flood admission and completion',
    '',
    'Rejected percentages count only typed admission rejections. The rejection',
    'latency columns describe failed admission, not successful completion.',
    '',
    '| Flood/s | Hold ms | Old/current successful writes/s | Current accepted / attempted | Current rejected (%) | Rejection arrival p50 / p95 / p99 ms | Rejection service p50 / p95 / p99 ms |',
    '| ---: | ---: | ---: | ---: | ---: | ---: | ---: |'
  );

  for (const rate of FLOOD_RATES) {
    for (const hold of HOLDS) {
      const old = caseKey(rate, hold, 'before', 'flood');
      const current = caseKey(rate, hold, 'after', 'flood');
      lines.push(
        `| ${rate} | ${hold} | ${mid(old, 'successful_ops_s')} / ${mid(current, 'successful_ops_s')} | ` +
          `${total(current, 'admission_accepted')} / ${total(current, 'attempts')} | ` +
          `${total(current, 'admission_rejected')} (${formatFixed(percentage(current), 2)}%) | ` +
          `${quantiles(current, 'rejection_arrival')} | ${quantiles(current, 'rejection_service')} |`
      );
    }
  }

  lines.push(
    '',
    '## Every neighbor run',
    '',
    '| Run | Flood/s | Hold ms | Variant | p50 / p95 / p99 ms | Errors | Admission rejected | Pool timeout |',
    '| ---: | ---: | ---: | --- | ---: | ---: | ---: | ---: |'
  );

  for (const row of rows) {
    if (row.lane === 'neighbor') {
      const arrival = PERCENTILES.map((p) => row[`arrival_p${p}_ms`]);
      lines.push(
        `| ${row.run} | ${row.flood_rate} | ${row.requested_hold_ms} | ${row.variant} | ` +
          `${arrival.join(' / ')} | ${row.errors} | ${row.admission_rejected} | ${row.pool_acquire_timeouts} |`
      );
    }
  }

  lines.push(
    '',
    '## Database and pool errors, every run',
    '',
    '| Run | Flood/s | Hold ms | Variant | Lane | Pool timeout | 55P03 | 57014 | 40P01 | Other |',
    '| ---: | ---: | ---: | --- | --- | ---: | ---: | ---: | ---: | ---: |'
  );

  const errorColumns = [
    'run',
    'flood_rate',
    'requested_hold_ms',
    'variant',
    'lane',
    ...ERRORS,
  ] as const;
  for (const row of rows) {
    const cells = errorColumns.map((field) => row[field]);
    lines.push(`| ${cells.join(' | ')} |`);
  }

  lines.push(
    '',
    'The requested hold is a stress input, not measured production disk',
    'latency. Actual hold distributions and every admission count are in the',
    'CSV. The shared host limits causal attribution; keep these results',
    'separate from the discarded deadline and closed-loop pool experiments.',
    'See [README.md](README.md) for commands and the simultaneous-post test.',
    ''
  );
  writeReport(output, 'channel_admission_pool_results.md', lines);
}

runProof(main);
