import { readFileSync, writeFileSync } from 'node:fs';
const edit = (f: string, pairs: [string | RegExp, string][]) => {
  let t = readFileSync(f, 'utf8');
  for (const [a, b] of pairs) { const n = t.replace(a, () => b); if (n === t) throw new Error(f + ' missing: ' + String(a).slice(0, 60)); t = n; }
  writeFileSync(f, t);
};
edit('ledger/proofs.tsv', [
  [/^CHN-15\tledger\/breaks\/channel-gone-not-believed\.patch\t.*$/m, 'CHN-15\tledger/breaks/channel-gone-not-believed.patch\tits marked check failed 14 of 14 (Error: expect(locator).toHaveCount(expected) failed); 7 of 13 without the break'],
  [/^CHN-08\tledger\/breaks\/favorite-does-nothing\.patch\t.*$/m, 'CHN-08\tledger/breaks/favorite-does-nothing.patch\tfailed: Error: expect(locator).toHaveText(expected) failed (at the Favorites step, before the deletion; no break of the deletion itself has been built)'],
]);
edit('ledger/intermittent-defects.tsv', [
  [/^CHN-15\t.*$/m, "CHN-15\tA channel deleted elsewhere sometimes stays open on its owner's page until reload (7 of 13 repeats and 4 of 8 whole-suite runs on ce183ced7f)"],
]);
edit('AGENTS.md', [[`  what a lost page left behind from what the next page fetched anyway.`, `  what a lost page left behind from what the next page fetched anyway.
  Nothing on screen says when the next page has kept it: OFF-14 relies on
  the pause \`goOffline\` makes, which held 30 of 30 at a load of 30 to 50.`]]);
