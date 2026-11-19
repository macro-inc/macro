const [body, page] = [process.argv[2], process.argv[3]];
const sub = async (path: string, pairs: [string, string][]) => {
  let t = await Bun.file(path).text();
  for (const [a, b] of pairs) { if (!t.includes(a)) throw new Error('no match: ' + a.slice(0, 50)); t = t.replace(a, b); }
  await Bun.write(path, t);
};
await sub(body, [
  ['The base branch at `92835f2c2a` and main are merged in again (no conflicts).', 'The base branch and main are merged in twice more as they moved (no conflicts); the head is `f5e3a35c63`.'],
  ['- `ledger/check.ts`: 164 tests, 67 of 84 listed behaviours covered, 10 known defects, 17 intermittent. `just check` passes.\n\n## After', '- One more whole run on each build at the pushed head `f5e3a35c63`, after the base moved again: local sync on 164 passed; off 129 passed, 35 skipped. Nothing unexpected. Marked defects that showed: ACC-06, CHN-02, CHN-08 and MEM-03 on; ACC-06, CHN-02, MSG-18 and UNR-08 off.\n- `ledger/check.ts`: 164 tests, 67 of 84 listed behaviours covered, 10 known defects, 17 intermittent. `just check` passes.\n\n## After'],
]);
await sub(page, [
  ['tests at <code>2266cb5eec</code> ·', 'tests at <code>f5e3a35c63</code> ·'],
  ['<b>Latest, on the merged head: both whole runs had nothing unexpected (164 passed with local sync on; 129 passed, 35 skipped off)', '<b>Latest, on the merged head: two whole runs on each build had nothing unexpected (164 passed with local sync on; 129 passed, 35 skipped off)'],
  ['<tr><td>Local sync on</td><td>164 passed</td><td>none</td><td>ACC-06, CHN-08, UNR-04</td></tr>\n<tr><td>Local sync off</td><td>129 passed, 35 skipped</td><td>none</td><td>ACC-06, CHN-02, MEM-03, MSG-18</td></tr>', '<tr><td>Local sync on, <code>596c31be38</code></td><td>164 passed</td><td>none</td><td>ACC-06, CHN-08, UNR-04</td></tr>\n<tr><td>Local sync off, <code>596c31be38</code></td><td>129 passed, 35 skipped</td><td>none</td><td>ACC-06, CHN-02, MEM-03, MSG-18</td></tr>\n<tr><td>Local sync on, <code>f5e3a35c63</code> (pushed head)</td><td>164 passed</td><td>none</td><td>ACC-06, CHN-02, CHN-08, MEM-03</td></tr>\n<tr><td>Local sync off, <code>f5e3a35c63</code> (pushed head)</td><td>129 passed, 35 skipped</td><td>none</td><td>ACC-06, CHN-02, MSG-18, UNR-08</td></tr>'],
  ['the pushed head <code>2266cb5eec</code> adds one line to UNR-06.', 'then the base moved again and was merged with main as <code>f5e3a35c63</code>, the pushed head, which ran once more on each build.'],
]);
