// Counts live snapshots by which reader still lagged the database when the
// live bound ran out: only main, only the head, or both alike. A lag that only
// the head shows is the race the other way round from main-stale.
// Usage: bun driver/livelag.ts <run dir>
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { judge } from './compare';

const dir = process.argv[2];
if (!dir) throw new Error('usage: livelag.ts <run dir>');
const table: Record<string, number> = {};
const headOnly: {
  line: number;
  seq: number;
  step: number;
  viewer: string;
  at: string;
  kind: string;
}[] = [];
let line = 0;
for await (const text of createInterface({
  input: createReadStream(`${dir}/records.jsonl`),
  crlfDelay: Number.POSITIVE_INFINITY,
})) {
  line += 1;
  if (!text) continue;
  const record = JSON.parse(text);
  if (record.mode !== 'live' || !record.snap || !record.truth) continue;
  const v = judge(record.snap, record.truth);
  const lag = (x: string) =>
    x === 'differs' || x === 'no-data' ? 'lags' : 'ok';
  const key = `main ${lag(v.oldVsTruth)} / head ${lag(v.newVsTruth)}`;
  table[key] = (table[key] ?? 0) + 1;
  if (lag(v.oldVsTruth) === 'ok' && lag(v.newVsTruth) === 'lags')
    headOnly.push({
      line,
      seq: record.seq,
      step: record.step,
      viewer: record.viewer,
      at: new Date(record.snap.at).toISOString(),
      kind: record.op?.kind ?? record.kind ?? '',
    });
}
console.log(JSON.stringify(table));
for (const h of headOnly) console.log(JSON.stringify(h));
