import { readFileSync, writeFileSync } from 'node:fs';
let t = readFileSync('/home/teo/.herdr/worktrees/macro/synoet-channels-e2e-b/apps/web/tests/channels-e2e/zz-probe2.spec.ts', 'utf8');
const a = "    if (hold) await new Promise<void>((done) => held.push(done));\n    await route.continue().catch(() => {});\n";
if (!t.includes(a)) throw new Error('missing');
t = t.replace(a, "    const answer = await route.fetch();\n    if (hold) await new Promise<void>((done) => held.push(done));\n    await route.fulfill({ response: answer }).catch(() => {});\n");
writeFileSync('/home/teo/.herdr/worktrees/macro/synoet-channels-e2e-b/apps/web/tests/channels-e2e/zz-probe2.spec.ts', t);
