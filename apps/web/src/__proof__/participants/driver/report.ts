// Summarizes every run under a results directory: counts, coverage, and each
// difference sorted into the explained classes (README.md, "Differences") or
// left unexplained. A clean run must have no unexplained difference; a mutant
// run must have at least one. Usage: bun driver/report.ts <results dir>
import {
  createReadStream,
  existsSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { createInterface } from 'node:readline';
import { explain, judge } from './compare';

const root = process.argv[2];
if (!root) throw new Error('usage: report.ts <results dir>');

/** The entry for a key, made on first use. */
function slot<T>(table: Record<string, T>, key: string, make: () => T): T {
  if (!(key in table)) table[key] = make();
  return table[key] as T;
}

type RunReport = {
  run: string;
  config: Record<string, unknown>;
  reads: number;
  sequences: number;
  steps: number;
  byMode: Record<string, number>;
  coverage: Record<string, Record<string, number>>;
  same: number;
  explained: Record<string, number>;
  /** How long after a live write each late reader caught up, with no reload. */
  lateMs: number[];
  unexplained: Record<string, { count: number; first: string }>;
  forms: unknown;
  live: unknown;
  reload: unknown;
  tieOrders: unknown;
  selfNavigations: number;
  requestFailed: unknown;
  lostCalls: unknown;
  hungCalls: Record<string, number>;
  verdict: string;
};

const reports: RunReport[] = [];
for (const name of readdirSync(root).sort()) {
  const dir = `${root}/${name}`;
  if (!existsSync(`${dir}/summary.json`)) continue;
  const summary = JSON.parse(readFileSync(`${dir}/summary.json`, 'utf8'));
  const config = JSON.parse(readFileSync(`${dir}/config.json`, 'utf8'));
  const explained: Record<string, number> = {};
  const lateMs: number[] = [];
  const unexplained: Record<string, { count: number; first: string }> = {};
  let differing = 0;
  if (existsSync(`${dir}/records.jsonl`)) {
    // Line by line: a run's records reach gigabytes (rosters of thousands).
    let index = -1;
    for await (const line of createInterface({
      input: createReadStream(`${dir}/records.jsonl`),
      crlfDelay: Number.POSITIVE_INFINITY,
    })) {
      index += 1;
      if (!line) continue;
      const record = JSON.parse(line);
      if (!record.snap) {
        // A form tile count that differs.
        const entry = slot(unexplained, record.signature, () => ({
          count: 0,
          first: `${dir}/records.jsonl:${index + 1}`,
        }));
        entry.count += 1;
        continue;
      }
      differing += 1;
      const verdict = judge(record.snap, record.truth);
      // A live read past the bound that caught up later, with no reload in
      // between: a late live update, not a lost one (run.ts, LATE_MS).
      const late =
        record.mode === 'live' && typeof record.caughtUpMs === 'number'
          ? record.caughtUpMs
          : undefined;
      const known =
        explain(verdict) ?? (late === undefined ? undefined : 'live.late');
      if (known === 'live.late' && late !== undefined) lateMs.push(late);
      if (known) {
        explained[known] = (explained[known] ?? 0) + 1;
        continue;
      }
      const signature = `${record.mode} | ${verdict.bucket} | contract: ${verdict.contractFields.join(',') || '-'} | data: ${verdict.dataFields.join(',') || '-'} | truth old ${verdict.oldVsTruth} new ${verdict.newVsTruth}`;
      const entry = slot(unexplained, signature, () => ({
        count: 0,
        first: `${dir}/records.jsonl:${index + 1}`,
      }));
      entry.count += 1;
    }
  }
  const mutant = config.MUTANT && config.MUTANT !== 'none';
  const caught = Object.values(unexplained).reduce(
    (sum, entry) => sum + entry.count,
    0
  );
  reports.push({
    run: name,
    config,
    reads: summary.reads,
    sequences: summary.sequences,
    steps: summary.steps,
    byMode: summary.byMode,
    coverage: summary.coverage,
    same: summary.reads - differing,
    explained,
    lateMs,
    unexplained,
    forms: summary.forms,
    live: {
      ...summary.live,
      latencies: undefined,
      p50: pct(summary.live.latencies, 0.5),
      p99: pct(summary.live.latencies, 0.99),
      max: pct(summary.live.latencies, 1),
      // Both readers still without data past the bound, alike.
      timedOutNeitherReads: Object.entries(summary.live.timedOutBy ?? {})
        .filter(([why]) => why.endsWith('head no-data, main no-data'))
        .reduce((sum, [, count]) => sum + (count as number), 0),
    },
    reload: {
      ...summary.reload,
      convergedAfter: summary.reload.convergedAfter.length,
    },
    tieOrders: summary.tieOrders,
    selfNavigations: summary.selfNavigations,
    requestFailed: summary.requestFailed,
    lostCalls: summary.lostCalls,
    hungCalls: summary.hungCalls ?? {},
    verdict: mutant
      ? caught
        ? `CAUGHT (${caught} reads)`
        : 'MISSED'
      : caught
        ? `${caught} unexplained`
        : productHangs(summary.hungCalls).length
          ? `HUNG ${JSON.stringify(summary.hungCalls)}`
          : 'clean',
  });
}

/** Hung calls other than loading the harness, which the drivers redo after a reload. */
function productHangs(hung: Record<string, number> | undefined) {
  return Object.keys(hung ?? {}).filter((method) => method !== 'install');
}

function pct(values: number[], p: number) {
  if (!values?.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}

for (const report of reports) {
  console.log(`\n== ${report.run}: ${report.verdict}`);
  console.log(
    `   seed ${report.config.SEED} load ${report.config.LOAD} mutant ${report.config.MUTANT}: ${report.reads} reads, ${report.sequences} sequences, ${report.steps} channel-steps; same ${report.same}`
  );
  console.log(`   modes ${JSON.stringify(report.byMode)}`);
  console.log(`   explained ${JSON.stringify(report.explained)}`);
  if (report.lateMs.length)
    console.log(
      `   live.late caught up after ${JSON.stringify([...report.lateMs].sort((a, b) => a - b))} ms`
    );
  for (const [signature, entry] of Object.entries(report.unexplained))
    console.log(
      `   UNEXPLAINED ${entry.count}× ${signature}  (${entry.first})`
    );
  console.log(
    `   live ${JSON.stringify(report.live)} reload ${JSON.stringify(report.reload)}`
  );
  console.log(
    `   forms ${JSON.stringify(report.forms)} ties ${JSON.stringify(report.tieOrders)} setup reloads ${report.selfNavigations}`
  );
  console.log(
    `   failed requests ${JSON.stringify(report.requestFailed)} lost harness calls ${JSON.stringify(report.lostCalls)} hung ${JSON.stringify(report.hungCalls)}`
  );
}
if (existsSync(`${root}/case37/case37.json`)) {
  const case37 = JSON.parse(readFileSync(`${root}/case37/case37.json`, 'utf8'));
  console.log(
    `\n== case37\n${JSON.stringify(case37.summary ?? case37, null, 1).slice(0, 4000)}`
  );
}
writeFileSync(`${root}/report.json`, JSON.stringify(reports, null, 2));
console.log(`\nreport -> ${root}/report.json`);
