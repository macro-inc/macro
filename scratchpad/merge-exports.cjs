// Three-way merge of a generated file whose conflict is one long sorted `export ... { a, b, c }` line.
const { execSync } = require('node:child_process'); const fs = require('node:fs');
const f = process.argv[2];
const text = fs.readFileSync(f, 'utf8');
const base = execSync(`git show :1:${f}`, { maxBuffer: 1 << 28 }).toString();
const m = text.match(/<<<<<<< HEAD\n([\s\S]*?)=======\n([\s\S]*?)>>>>>>> origin\/main\n/);
if (!m || text.split('<<<<<<<').length !== 2) throw new Error('expected one conflict');
const ours = m[1].split('\n').filter(Boolean), theirs = m[2].split('\n').filter(Boolean);
if (ours.length !== theirs.length) throw new Error(`line counts differ ${ours.length} ${theirs.length}`);
const names = (l) => { const x = l.match(/^(.*?\{ )(.*)( \}.*)$/); if (!x) throw new Error('not an export line: ' + l.slice(0, 80)); return [x[1], x[2].split(', '), x[3]]; };
const out = ours.map((o, i) => {
  const [po, no, so] = names(o); const [pt, nt, st] = names(theirs[i]);
  if (po !== pt || so !== st) throw new Error('prefix differs');
  const bl = base.split('\n').find((l) => l.startsWith(po) && l.endsWith(so)); const nb = new Set(bl ? names(bl)[1] : []);
  const set = new Set(nt); const added = no.filter((n) => !nb.has(n) && !set.has(n));
  const all = [...nt, ...added].sort((a, b) => a.toLowerCase() < b.toLowerCase() ? -1 : a.toLowerCase() > b.toLowerCase() ? 1 : (a < b ? -1 : 1));
  const sortedTheirs = [...nt].sort((a, b) => a.toLowerCase() < b.toLowerCase() ? -1 : a.toLowerCase() > b.toLowerCase() ? 1 : (a < b ? -1 : 1));
  console.log(f, 'added from ours:', added.join(', '), '| sort matches generator:', sortedTheirs.join() === nt.join());
  return po + all.join(', ') + so;
});
fs.writeFileSync(f, text.replace(m[0], out.join('\n') + '\n'));
