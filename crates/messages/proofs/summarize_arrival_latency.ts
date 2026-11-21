#!/usr/bin/env bun
// Summarize complete release fixed-arrival and commit-delay benchmark logs.
import {
  check,
  compareKeys,
  formatFixed,
  groupOf,
  groupRows,
  median,
  parseCommandLine,
  readLines,
  runProof,
  tableCells,
  toFloat,
  toInt,
  toRow,
  usageError,
  writeReport,
  writeRunsCsv,
} from './proof_support';

const HELP = `usage: summarize_arrival_latency.ts [-h] [--output OUTPUT] logs logs

Summarize complete release fixed-arrival and commit-delay benchmark logs.

positional arguments:
  logs

options:
  -h, --help       show this help message and exit
  --output OUTPUT
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

const ARRIVAL = ['arrival_p50_ms', 'arrival_p95_ms', 'arrival_p99_ms'] as const;

function caseKey(...parts: string[]): string {
  return parts.join('|');
}

function readRows(paths: readonly string[]): Row[] {
  const rows: Row[] = [];

  for (const path of paths) {
    for (const line of readLines(path)) {
      if (!line.startsWith('| multi_thread_16 |')) {
        continue;
      }

      const values = tableCells(line);
      check(values.length === FIELDS.length, path, line);
      const row = toRow(FIELDS, values);
      check(row.profile === 'release', row);
      check(row.n === '2000' && row.connections === '16', row);
      rows.push(row);
    }
  }

  return rows;
}

function main(): void {
  const { values, positionals: logs } = parseCommandLine(HELP, {
    output: { type: 'string' },
  });
  if (logs.length !== 2) {
    usageError(HELP, 'expected exactly two logs');
  }

  const output = values.output ?? import.meta.dir;
  const rows = readRows(logs);
  const groups = groupRows(rows, (row) =>
    caseKey(
      row.mode,
      row.channels,
      row.offered_ops_s,
      row.requested_hold_ms,
      row.variant
    )
  );
  check(rows.length === 108 && groups.size === 36, rows.length, groups.size);
  for (const group of groups.values()) {
    const runs = group.map((row) => row.run).sort();
    check(runs.join(',') === '1,2,3' && runs.length === 3, group);
  }

  writeRunsCsv(output, 'channel_arrival_latency_runs.csv', FIELDS, rows);

  function value(key: string, field: Field): number {
    return median(groupOf(groups, key).map((row) => toFloat(row[field])));
  }

  function summary(key: string): string {
    return ARRIVAL.map((field) => formatFixed(value(key, field), 3)).join(
      ' / '
    );
  }

  function achieved(key: string): string {
    return formatFixed(value(key, 'achieved_ops_s'), 1);
  }

  const lines = [
    '# Historical fixed-arrival and delayed-commit write results',
    '',
    'Historical source snapshot: `before` is pinned to `354da677b5`; `after` is',
    'the pre-timeout implementation at `5743b47a10`. All numbers in this report',
    'predate both the discarded per-lock limits and the total statement deadline.',
    'They are retained as baseline evidence, not current deadline measurements.',
    'Reproduce them only with the original source and benchmark harness in a separate',
    'checkout. Current below-ceiling and shared-pool evidence uses the result-recording',
    'runners described in [README.md](README.md).',
    '',
    'Release build, one local PostgreSQL 18.4 database server, sixteen Tokio',
    'workers and sixteen connections. Database files were on local tmpfs;',
    'fsync and synchronous_commit were enabled. The injected delay adds',
    'lock occupancy but does not reproduce a particular production disk.',
    'Each row compares the pinned old',
    'repository with the pre-timeout repository on the same server: three runs',
    'of 2,000 mixed writes each (500 create, edit, react and delete). Each',
    'case has 128 unmeasured warmup writes. The four operations use distinct',
    'message rows; all operations rotate through all selected channels.',
    '',
    'Table values are medians of the three per-run percentiles and achieved',
    'rates, not percentiles pooled across runs. The CSV retains every run.',
    'Latency starts at the original scheduled arrival and includes scheduler',
    'delay, the sixteen-worker admission queue, pool and counter waits, SQL,',
    'and commit acknowledgement. A fixed timer schedules every arrival',
    'independently of completions; missed ticks burst with their original',
    'timestamps. No arrival is dropped. Achieved rate is completed writes',
    'divided by wall time from first scheduled arrival through final completion.',
    "This worktree's builds, tests and query-plan jobs were idle during timing.",
    'The host was shared with other worktrees, so these local measurements',
    'are not a guarantee of production capacity or an isolated-host result.',
    '',
    '## Fixed arrivals without an injected delay',
    '',
    '| Channels | Offered writes/s | Old p50 / p95 / p99 ms | New p50 / p95 / p99 ms | Old achieved/s | New achieved/s |',
    '| ---: | ---: | ---: | ---: | ---: | ---: |',
  ];

  for (const channels of ['1', '16']) {
    for (const rate of ['50', '200', '1000', '3000']) {
      const old = caseKey('open_loop', channels, rate, '0.000', 'before');
      const current = caseKey('open_loop', channels, rate, '0.000', 'after');
      lines.push(
        `| ${channels} | ${rate} | ${summary(old)} | ${summary(current)} | ` +
          `${achieved(old)} | ${achieved(current)} |`
      );
    }
  }

  lines.push(
    '',
    '## Synthetic pre-commit hold in one channel',
    '',
    "Benchmark-only copies preserve each variant's ordered SQL and insert",
    'one asynchronous sleep after its final statement, immediately before',
    'COMMIT. The current copy holds the counter during that sleep; the old',
    'copy has no counter. Production code has no artificial delay or hook.',
    'Requested sleeps are minimum delays, not exact server commit latency;',
    'Tokio timer granularity and scheduling can lengthen them. The measured',
    'sleep distributions below make that difference explicit. Real commit',
    'round trips also remain in both measurements. These are sensitivity',
    "measurements, not predictions of a deployed database's capacity.",
    '',
    '| Requested hold ms | Mode | Offered writes/s | Old p50 / p95 / p99 ms | New p50 / p95 / p99 ms | Old achieved/s | New achieved/s | Old actual hold p50 / p95 ms | New actual hold p50 / p95 ms |',
    '| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |'
  );

  function actualHold(key: string): string {
    const p50 = formatFixed(value(key, 'actual_hold_p50_ms'), 3);
    const p95 = formatFixed(value(key, 'actual_hold_p95_ms'), 3);
    return `${p50} / ${p95}`;
  }

  for (const hold of ['2', '5']) {
    // The closed-loop case has no offered rate; its logs record `-`.
    for (const rate of ['-', '20', '50', '100', '200']) {
      const mode = rate === '-' ? 'closed_loop' : 'open_loop';
      const old = caseKey(mode, '1', rate, `${hold}.000`, 'before');
      const current = caseKey(mode, '1', rate, `${hold}.000`, 'after');
      lines.push(
        `| ${hold} | ${mode} | ${rate} | ${summary(old)} | ${summary(current)} | ` +
          `${achieved(old)} | ${achieved(current)} | ` +
          `${actualHold(old)} | ${actualHold(current)} |`
      );
    }
  }

  lines.push('', '### Run variation near capacity', '');

  for (const hold of ['2', '5']) {
    const perVariant = ['before', 'after'].map((variant) => {
      const key = caseKey('open_loop', '1', '200', `${hold}.000`, variant);
      return groupOf(groups, key)
        .toSorted((left, right) =>
          compareKeys([toInt(left.run)], [toInt(right.run)])
        )
        .map((row) => row.arrival_p95_ms)
        .join(' / ');
    });
    lines.push(
      `At ${hold} ms requested hold and 200 offered writes/s, arrival p95 in ` +
        `runs 1/2/3 was ${perVariant[0]} ms before and ` +
        `${perVariant[1]} ms after.`,
      ''
    );
  }

  lines.push(
    'Open-loop samples with p99 at least 100 ms are listed explicitly,',
    'including tails below the measured saturation rate:',
    '',
    '| Hold ms | Offered writes/s | Run | Variant | p95 ms | p99 ms | Achieved writes/s |',
    '| ---: | ---: | ---: | --- | ---: | ---: | ---: |'
  );

  for (const row of rows) {
    if (row.mode === 'open_loop' && toFloat(row.arrival_p99_ms) >= 100) {
      lines.push(
        `| ${row.requested_hold_ms} | ${row.offered_ops_s} | ` +
          `${row.run} | ${row.variant} | ${row.arrival_p95_ms} | ` +
          `${row.arrival_p99_ms} | ${row.achieved_ops_s} |`
      );
    }
  }

  lines.push(
    '',
    'A median does not imply that every run stayed near that value. Use the',
    'per-run values and actual hold distributions when assessing tail risk.',
    '',
    'The closed-loop cases have sixteen continuously active writers and',
    'measure saturation. The open-loop cases preserve offered work even',
    'when demand exceeds the measured ceiling; a lower achieved rate and',
    'growing end-to-end latency therefore expose the backlog instead of',
    'hiding it by slowing the request generator.',
    '',
    'See [the writer-rate audit](channel_writer_rates.md) for the absence',
    'of a general per-channel rate cap, and',
    '[the transaction audit](channel_transaction_audit.md) for lock lifetime and timeout behavior.',
    'The [closed-loop repository results](channel_write_latency_results.md)',
    'retain the original per-operation saturation comparison.',
    '',
    'Reproduce the historical commands from the pre-timeout source/harness checkout',
    '(see [README.md](README.md)), then run:',
    '',
    '```sh',
    'bun crates/messages/proofs/summarize_arrival_latency.ts \\',
    '  /tmp/open-loop.log /tmp/commit-delay.log',
    '```',
    ''
  );
  writeReport(output, 'channel_arrival_latency_results.md', lines);
}

runProof(main);
