// Applies the current classes to a finished read phase's leftover diffs
// (read-diffs.jsonl), for classes added after the phase ran. Prints what each
// class took and writes what is left to read-diffs.reclassified.jsonl.
import fs from 'node:fs';
import path from 'node:path';
import { classifyContract, summarizeClassified } from './classify.mjs';

const dir = path.resolve(process.argv[2]);
const lines = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const errors = new Map();
for (const e of lines(path.join(dir, 'dm-errors.jsonl'))) errors.set(`${e.viewer}|${e.spec}|${e.mode}`, e.errors);
const summary = {};
const left = [];
let before = 0;
for (const row of lines(path.join(dir, 'read-diffs.jsonl'))) {
  before++;
  const branch = row.pair.split('~')[1];
  const { kept, classified } = await classifyContract(row.diffs, {
    viewer: row.viewer, mainFacts: undefined, members: async () => null,
    branchDmErrors: errors.get(`${row.viewer}|${row.spec}|${branch}`),
  });
  summarizeClassified(classified, (summary[row.pair] ??= {}), { viewer: row.viewer, spec: row.spec });
  if (Object.keys(kept).length) left.push({ ...row, diffs: kept });
}
fs.writeFileSync(path.join(dir, 'read-diffs.reclassified.jsonl'), left.map((r) => JSON.stringify(r)).join('\n') + (left.length ? '\n' : ''));
const counts = Object.fromEntries(Object.entries(summary).map(([p, c]) => [p, Object.fromEntries(Object.entries(c).map(([k, v]) => [k, v.count]))]));
console.log(JSON.stringify({ dir: path.basename(dir), pairsWithDiffs: before, pairsLeft: left.length, classified: counts }));
