import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
const f = 'apps/web/AGENTS.md';
const ours = execSync(`git show HEAD:${f}`, { maxBuffer: 1 << 28 }).toString().split('\n');
const mine = ours.filter((l) => l.startsWith('- With `enable-channel-local-sync` (`enableChannelLocalSync`; no default'));
const L = readFileSync(f, 'utf8').split('\n');
const idx = L.map((l, i) => (l.startsWith('- With `enable-channel-local-sync` (`enableChannelLocalSync`; no default') ? i : -1)).filter((i) => i >= 0);
if (mine.length !== 1 || idx.length !== 1) throw new Error(`shape ${mine.length} ${idx.length}`);
console.log('same bullet:', L[idx[0]] === mine[0], L[idx[0]].length, mine[0].length);
L[idx[0]] = mine[0];
writeFileSync(f, L.join('\n'));
const p = 'apps/web/docs/graphql-normalized-cache-plan.md';
let t = readFileSync(p, 'utf8');
const from = '    inspections carried the lease.\n';
if (!t.includes(from)) throw new Error('plan');
t = t.replace(from, `    inspections carried the lease. An enqueue claims the head inside the
    host; when its answer is lost the head stays leased to this page with
    nothing sending it, so the next refused claim releases a lease this page
    took, has no enqueue on its way for, and is not sending under
    (\`releaseUnroutedLease\`).
`);
writeFileSync(p, t);
