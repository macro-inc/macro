import { readFileSync, writeFileSync } from 'node:fs';
const sub = (file: string, a: RegExp | string, b: string) => {
  const p = '/home/teo/.herdr/worktrees/macro/synoet-channels-e2e-b/apps/web/tests/channels-e2e/' + file;
  const t = readFileSync(p, 'utf8');
  const n = t.replace(a, b);
  if (n === t) throw new Error('no change in ' + file + ' for ' + String(a).slice(0, 40));
  writeFileSync(p, n);
};
sub('harness/network.ts', /const body: \{ next_cursor\?: string \| null \} =\s*await response\.json\(\);\s*return !body\.next_cursor;/, `try {
          const body: { next_cursor?: string | null } = await response.json();
          return !body.next_cursor;
        } catch {
          // the page moved on before the answer could be read
          return false;
        }`);
sub('harness/network.ts', /const answer = await route\.fetch\(\);\s*if \(holding\) await new Promise<void>\(\(letGo\) => held\.push\(letGo\)\);\s*try \{\s*await route\.fulfill\(\{ response: answer \}\);/, `try {
      const answer = await route.fetch();
      if (holding) await new Promise<void>((letGo) => held.push(letGo));
      await route.fulfill({ response: answer });`);
sub('harness/management.ts', "await dialog.getByRole('option').filter({ hasText: email }).click();", "await dialog.getByRole('option').filter({ hasText: email }).first().click();");
