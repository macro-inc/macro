import { readFileSync, writeFileSync } from 'node:fs';
for (const f of process.argv.slice(2)) {
  const out: string[] = [];
  let state = 0;
  for (const l of readFileSync(f, 'utf8').split('\n')) {
    if (l.startsWith('<<<<<<< ')) state = 1;
    else if (l === '=======' && state === 1) state = 2;
    else if (l.startsWith('>>>>>>> ') && state === 2) state = 0;
    else if (state !== 1) out.push(l);
  }
  writeFileSync(f, out.join('\n'));
}
