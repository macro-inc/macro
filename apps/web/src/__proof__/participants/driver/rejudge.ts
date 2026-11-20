// Re-judges a run's recorded differences with the current compare.ts, so a
// change to the comparison can be checked against data already collected.
// Usage: bun driver/rejudge.ts <run dir>
import { readFileSync } from 'node:fs';
import { judge } from './compare';

const dir = process.argv[2];
if (!dir) throw new Error('usage: rejudge.ts <run dir>');
const tally: Record<string, number> = {};
for (const line of readFileSync(`${dir}/records.jsonl`, 'utf8').split('\n')) {
  if (!line) continue;
  const record = JSON.parse(line);
  const verdict = judge(record.snap, record.truth);
  const signature = `${record.mode} | ${verdict.bucket} | contract: ${verdict.contractFields.join(',') || '-'} | data: ${verdict.dataFields.join(',') || '-'} | truth old ${verdict.oldVsTruth} new ${verdict.newVsTruth}`;
  tally[signature] = (tally[signature] ?? 0) + 1;
}
for (const [signature, count] of Object.entries(tally).sort(
  (a, b) => b[1] - a[1]
))
  console.log(`${count}\t${signature}`);
