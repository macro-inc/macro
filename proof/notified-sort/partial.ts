// Mid-run tally of out/<run>/: difference classes seen so far in reads, dom
// and steps, split into closed (with closure id) and open.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { closureOf } from './lib/closed.ts';
import { homeCheckClosure } from './lib/dom-held.ts';

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
// As report.ts: an open Home check whose recorded rows show main held (B1)
// or the sides apart only in stale time labels (L1, E1) counts under it.
const moved = (s: any, cls: string) => {
  const c = s.checks;
  if (closureOf(cls) || !c.domRows || !c.domReload || c.domReload.newHeld || !c.domReload.sides.every((x: string) => closureOf(x))) return cls;
  const judged = homeCheckClosure(c.domRows, [cls]);
  return judged ? cls.replace(/ dom:.*$/, ` ${judged.suffix}`) : cls;
};
for (const s of steps)
  for (const [k, v] of Object.entries<any>(s.checks ?? {})) {
    const classes: string[] = Array.isArray(v) && typeof v[0] === 'string' ? v : (v?.classes ?? []);
    if (k === 'live' || k === 'liveMisses' || k === 'domRereads' || k === 'domRows' || /errors$/.test(k)) continue;
    for (const c of classes) add(k === 'dom' ? moved(s, c) : c);
  }
console.log(JSON.stringify({ run, reads: reads.length, dom: dom.length, steps: steps.length, open: Object.fromEntries(open), closed: Object.fromEntries(closed) }, null, 1));
