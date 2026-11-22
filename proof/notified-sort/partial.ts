// Mid-run tally of out/<run>/: difference classes seen so far in reads, dom
// and steps, split into closed (with closure id) and open.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { closureOf } from './lib/closed.ts';

const run = process.argv[2] ?? 'quiet';
const dir = join(import.meta.dirname, 'out', run);
const open = new Map<string, number>();
const closed = new Map<string, number>();
const add = (cls: string) => {
  const c = closureOf(cls);
  const m = c ? closed : open;
  const k = c ? c.id : cls;
  m.set(k, (m.get(k) ?? 0) + 1);
};
const lines = (f: string) => (existsSync(join(dir, f)) ? readFileSync(join(dir, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const reads = lines('reads.jsonl');
for (const r of reads) for (const c of r.classes ?? []) add(c);
const dom = lines('dom.jsonl');
for (const r of dom) for (const c of r.classes ?? []) add(c);
const steps = lines('steps.jsonl');
for (const s of steps)
  for (const [k, v] of Object.entries<any>(s.checks ?? {})) {
    const classes: string[] = Array.isArray(v) && typeof v[0] === 'string' ? v : (v?.classes ?? []);
    if (k === 'live' || k === 'liveMisses' || k === 'domRereads' || k === 'domRows' || /errors$/.test(k)) continue;
    for (const c of classes) add(c);
  }
console.log(JSON.stringify({ run, reads: reads.length, dom: dom.length, steps: steps.length, open: Object.fromEntries(open), closed: Object.fromEntries(closed) }, null, 1));
