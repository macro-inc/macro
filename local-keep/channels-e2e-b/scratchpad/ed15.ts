import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
const sub = (file: string, a: string | RegExp, b: string) => {
  const t = readFileSync(file, 'utf8'); const n = t.replace(a, () => b);
  if (n === t) throw new Error('missing in ' + file + ': ' + String(a).slice(0, 60)); writeFileSync(file, n);
};
// copy feedback is no longer a toast
sub('channels.spec.ts', `  await expect(page.getByText('Link copied to clipboard')).toBeVisible();
  const link = await page.evaluate(() => navigator.clipboard.readText());`, `  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toContain(channel.id);
  const link = await page.evaluate(() => navigator.clipboard.readText());`);
sub('location.spec.ts', `  await expect(page.getByText('Link copied to clipboard')).toBeVisible();
  const link = await page.evaluate(() => navigator.clipboard.readText());
  expect(link).toContain(target.id);`, `  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toContain(target.id);
  const link = await page.evaluate(() => navigator.clipboard.readText());`);
sub('messages.spec.ts', `  await expect(page.getByText('Message copied to clipboard')).toBeVisible();\n`, '');
// marks
sub('channels.spec.ts', `  // Known defect on main: the deleted channel leaves "All channels" but its
  // row stays under Favorites, opening "Conversation unavailable", until the
  // page is reloaded.
  // With VITE_ENABLE_CHANNEL_LOCAL_SYNC the row goes at once on some machines and
  // stays on others.
  knownDefect('off');
`, `  // Defect, in some runs: the deleted channel leaves "All channels" but its
  // row stays under Favorites, opening "Conversation unavailable", until the
  // page is reloaded.
`);
sub('channels.spec.ts', `  // Known defect on main: when nothing else reaches the person around the
  // deletion, their open page keeps the channel and its composer until a
  // reload. In every run without VITE_ENABLE_CHANNEL_LOCAL_SYNC, in about 1 run
  // in 3 with it.
  knownDefect('off');
`, `  // Defect, in some runs: when nothing else reaches the person around the
  // deletion, their open page keeps the channel and its composer until a
  // reload.
`);
sub('members.spec.ts', /  \/\/ Known defect on main: when nothing else reaches the removed person\n([^\n]*\n)*?  knownDefect\('off'\);\n/, `  // Defect, in some runs: when nothing else reaches the removed person
  // around the removal, their page keeps the channel, its composer and its
  // row in the list until a reload; what they send then vanishes unsaid.
`);
sub('direct-messages.spec.ts', /  \/\/ Product defect: the box offers nobody for a name\.[^\n]*\n([^\n]*\n)*?  knownDefect\('off'\);\n/, '');
sub('direct-messages.spec.ts', '  // Defect with VITE_ENABLE_CHANNEL_LOCAL_SYNC: the first conversation these two', '  // Defect: the first conversation these two');
sub('unread.spec.ts', `  // Known defect with VITE_ENABLE_CHANNEL_LOCAL_SYNC: rows shown while the list
  // is being searched are not marked until the search is closed.
  knownDefect('on');`, `  // Known defect: rows shown while the list is being searched are not marked
  // until the search is closed.
  knownDefect('both');`);
for (const f of readdirSync('.').filter((n) => n.endsWith('.spec.ts'))) {
  const t = readFileSync(f, 'utf8');
  writeFileSync(f, t.replaceAll('failsSometimesWithLocalSync', 'failsSometimes'));
}
sub('harness/fixtures.ts', /\n\/\*\* `failsSometimes` on the builds with the flag, a plain check on the others\. \*\/\nexport async function failsSometimesWithLocalSync\([\s\S]*?\n}\n/, '\n');
// ledgers
let k = readFileSync('ledger/known-defects.tsv', 'utf8').split('\n').filter((l) => !/^(CHN-08|CHN-15|MEM-03|DM-06)\t/.test(l)).join('\n');
k = k.replace('UNR-10\ton\t', 'UNR-10\tboth\t');
writeFileSync('ledger/known-defects.tsv', k);
let i = readFileSync('ledger/intermittent-defects.tsv', 'utf8').split('\n').map((l) => {
  if (/^(UNR-04|CHN-15|ACC-06|CHN-08|UNR-08|MEM-03|DM-02)\t/.test(l)) {
    return l.replace(/\tWith VITE_ENABLE_CHANNEL_LOCAL_SYNC (.)/, (_, c) => '\t' + c.toUpperCase());
  }
  return l;
}).join('\n');
writeFileSync('ledger/intermittent-defects.tsv', i);
