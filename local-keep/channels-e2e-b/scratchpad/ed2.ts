import { readFileSync, writeFileSync } from 'node:fs';
const f = '/home/teo/.herdr/worktrees/macro/synoet-channels-e2e-b/apps/web/tests/channels-e2e/zz-probe2.spec.ts';
let t = readFileSync(f, 'utf8');
t = t.replace(/  const patched = .*\n/, '');
t = t.replace(/  console\.log\('HELD patch'.*\n/, "  await expect(dialog).toBeHidden();\n  await page.waitForTimeout(3000);\n  console.log('HELD list asked', asked, 'held', held.length, 'server name', JSON.stringify((await ada.channelName?.(channel.id)) ?? 'n/a'));\n");
t = t.replace('test.setTimeout(200_000)', 'test.setTimeout(150_000)');
writeFileSync(f, t);
