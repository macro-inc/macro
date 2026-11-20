// Summarizes every run under a results directory: counts, coverage, and each
// difference sorted into the explained classes (README.md, "Differences") or
// left unexplained. A clean run must have no unexplained difference; a mutant
// run must have at least one. Usage: bun driver/report.ts <results dir>
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { judge, type Verdict } from './compare';

const root = process.argv[2];
if (!root) throw new Error('usage: report.ts <results dir>');

/** Data fields whose difference is explained, with where the cause lives. */
const EXPLAINED_FIELDS: Record<string, string> = {
  'field.joined_at.format':
    'join time written "Z" (REST) vs "+00:00" (GraphQL): the same instant',
  'field.left_at.missing':
    "head's REST fallback and overlay rows carry left_at: null; main's rows omit it",
  'field.joined_at.client-stamped':
    'a row both sides show with the time each stamped when the add was sent',
  'order.ties':
    'rows that joined at the same instant, in an order neither read defines',
};

/** The entry for a key, made on first use. */
function slot<T>(table: Record<string, T>, key: string, make: () => T): T {
  if (!(key in table)) table[key] = make();
  return table[key] as T;
}

function classify(verdict: Verdict): string | undefined {
  if (verdict.bucket === 'tie-order') return 'tie-order';
  if (verdict.bucket === 'main-stale') return 'main-stale';
  if (verdict.bucket !== 'data-only') return undefined;
  const unexplained = verdict.dataFields.filter(
    (field) => !(field in EXPLAINED_FIELDS)
  );
  if (unexplained.length) return undefined;
  return verdict.dataFields.join('+');
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
  unexplained: Record<string, { count: number; first: string }>;
  forms: unknown;
  live: unknown;
  reload: unknown;
  tieOrders: unknown;
  selfNavigations: number;
  verdict: string;
};

const reports: RunReport[] = [];
for (const name of readdirSync(root).sort()) {
  const dir = `${root}/${name}`;
  if (!existsSync(`${dir}/summary.json`)) continue;
  const summary = JSON.parse(readFileSync(`${dir}/summary.json`, 'utf8'));
  const config = JSON.parse(readFileSync(`${dir}/config.json`, 'utf8'));
  const explained: Record<string, number> = {};
  const unexplained: Record<string, { count: number; first: string }> = {};
  let differing = 0;
  if (existsSync(`${dir}/records.jsonl`)) {
    const lines = readFileSync(`${dir}/records.jsonl`, 'utf8').split('\n');
    lines.forEach((line, index) => {
      if (!line) return;
      const record = JSON.parse(line);
      if (!record.snap) {
        // A form tile count that differs.
        const entry = slot(unexplained, record.signature, () => ({
          count: 0,
          first: `${dir}/records.jsonl:${index + 1}`,
        }));
        entry.count += 1;
        return;
      }
      differing += 1;
      const verdict = judge(record.snap, record.truth);
      const known = classify(verdict);
      if (known) {
        explained[known] = (explained[known] ?? 0) + 1;
        return;
      }
      const signature = `${record.mode} | ${verdict.bucket} | contract: ${verdict.contractFields.join(',') || '-'} | data: ${verdict.dataFields.join(',') || '-'} | truth old ${verdict.oldVsTruth} new ${verdict.newVsTruth}`;
      const entry = slot(unexplained, signature, () => ({
        count: 0,
        first: `${dir}/records.jsonl:${index + 1}`,
      }));
      entry.count += 1;
    });
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
    unexplained,
    forms: summary.forms,
    live: {
      ...summary.live,
      latencies: undefined,
      p50: pct(summary.live.latencies, 0.5),
      p99: pct(summary.live.latencies, 0.99),
      max: pct(summary.live.latencies, 1),
    },
    reload: {
      ...summary.reload,
      convergedAfter: summary.reload.convergedAfter.length,
    },
    tieOrders: summary.tieOrders,
    selfNavigations: summary.selfNavigations,
    verdict: mutant
      ? caught
        ? `CAUGHT (${caught} reads)`
        : 'MISSED'
      : caught
        ? `${caught} unexplained`
        : 'clean',
  });
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
  for (const [signature, entry] of Object.entries(report.unexplained))
    console.log(
      `   UNEXPLAINED ${entry.count}× ${signature}  (${entry.first})`
    );
  console.log(
    `   live ${JSON.stringify(report.live)} reload ${JSON.stringify(report.reload)}`
  );
  console.log(
    `   forms ${JSON.stringify(report.forms)} ties ${JSON.stringify(report.tieOrders)} self-navigations ${report.selfNavigations}`
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
