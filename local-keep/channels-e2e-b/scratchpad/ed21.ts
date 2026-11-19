import { readFileSync, writeFileSync } from 'node:fs';
const edit = (f: string, pairs: [string, string][]) => {
  let t = readFileSync(f, 'utf8');
  for (const [a, b] of pairs) { if (!t.includes(a)) throw new Error(f + ' missing: ' + a.slice(0, 60)); t = t.replace(a, () => b); }
  writeFileSync(f, t);
};
edit('ledger/inventory.tsv', [[`device-first-visit\t`, `device-cut-off-reload\tA thread read on a page that was reloaded before the device kept it is kept by the next page\tOFF-14\t\ndevice-first-visit\t`]]);
edit('AGENTS.md', [[`- With the flag, a page reloaded and then cut off knows only about a hundred
  of its person's newest channels (OFF-13): a test repeated thirty times in
  one run makes more than that, and the run's \`history\` channel then says
  "Conversation unavailable" offline (OFF-04, OFF-12). Judge those two from
  whole runs, or from repeats short enough to stay under a hundred channels,
  and give each run a run directory of its own: a run that finds an earlier
  run's \`history\` channel in its directory reads one that old.`, `- Give each run a run directory of its own: a run that finds an earlier
  run's \`history\` channel in its directory reads one that old, behind every
  channel made since (OFF-13 is the test of a held channel that old).
- A new page takes a second or two to start keeping channels, and under load
  more. \`holdDeviceBack\` makes that moment last: the page reads from the
  services and keeps nothing until it is let go (OFF-14). A device fetches
  recent channels by itself but not their threads, so only a thread tells
  what a lost page left behind from what the next page fetched anyway.
- A break patch that no longer applies proves nothing: after merging the
  base, run \`git apply --check\` over \`ledger/breaks/\` and prove again the
  tests of each patch that had to be rewritten.`]]);
