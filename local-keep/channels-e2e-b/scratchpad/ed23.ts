import { readFileSync, writeFileSync } from 'node:fs';
const s = process.argv[2];
let f = s + '/pr-body.md';
let t = readFileSync(f, 'utf8');
const sub = (a: string | RegExp, b: string) => { const n = t.replace(a, () => b); if (n === t) throw new Error('missing: ' + String(a).slice(0, 60)); t = n; };
sub('merged in at `9d6f721ec2`, and main after it.', 'merged in at `ce183ced7f`, and main after it.');
sub('- Adds 44 tests: OFF-13 in `offline.spec.ts` (a held channel offline once 120 others are newer),', '- Adds 45 tests: OFF-14 in `offline.spec.ts` (a thread read on a page that was left before the device kept it), OFF-13 (a held channel offline once 120 others are newer),');
sub('These four have no break proof yet and their rows say so: CHN-08, CHN-15, MEM-03, DM-06.', 'All four now have break proofs (see the newest round).');
sub('## On the newest base, one flag\n', `## On the base with the fixes for OFF-06, OFF-09 and OFF-13

At \`ce183ced7f\` (web code only changed; the cache engine passes the stale-engine check), both bundles rebuilt, same stack.

- Local sync on, five whole runs of 164 tests: all five with nothing unexpected. Off, three whole runs: two with nothing unexpected (129 passed, 35 skipped), one with one failure.
- The one failure, off: MSG-18, once. One person's own four messages, sent one after another while another person sent four, showed on a page as 1, 3, 2, 4. Not seen before; in thirty repeats on each build afterwards it did not show again. No cause found.
- OFF-06, OFF-09 and OFF-13, thirty times each with local sync on: 90 of 90. OFF-13 is no longer a known defect and OFF-06 no longer marked as failing sometimes.
- OFF-14 is new and forces the cut-off: the device's engine is held back, so the page reads a thread from the services and cannot keep it; the app is then loaded again on another channel, the engine let through, and the thread opened with no connection. 30 of 30. Under a break that makes the next page ignore what an earlier page left noted it fails, while OFF-06 and OFF-09 pass, so it is that path it exercises. Nothing on screen says when the next page has kept the thread; the test relies on the pause before the connection is lost.
- Break proofs added: CHN-08 (its break stops the test at the Favorites step, before the deletion), DM-06 (a name typed offers nobody), CHN-15 and MEM-03 (a channel the services say is gone stays open: the marked check failed 14 of 14 and 4 of 4 under the break, against 7 of 13 and 0 of 3 without), OFF-13 and OFF-14.
- Four break patches no longer applied to this base (\`device-not-used\`, \`copy-text-copies-nothing\`, \`prewarm-limits-changed\`, \`waiting-write-not-shown-in-other-window\`). They are rewritten and their 22 tests fail under them again. The other breaks apply but were not rebuilt on this head.
- With local sync off the base now opens a channel the cache knows with no connection, showing the channel with failing message reads. No test covers that: the offline tests are skipped on that build.
- Marked defects that showed in these eight runs: ACC-06 in all eight, CHN-02 in five, CHN-15 in three, MSG-18 and THR-02 in two each, MEM-03, CHN-08, KEY-05 and UNR-04 in one each.
- Machine load during the runs: one-minute average 21 to 60. Seven bundle builds ran during the first whole run.

## On the base before, one flag
`);
sub('At `9d6f721ec2`, engine rebuilt, on the same new stack', 'At `9d6f721ec2`, engine rebuilt, on the same stack');
writeFileSync(f, t);

f = s + '/channels-device-proof.html';
t = readFileSync(f, 'utf8');
sub(/<p class="mut">Approach B, flag on, branch .*?<\/p>/s, '<p class="mut">Approach B, branch <code>synoet/channels-local-sync-pr5-writes</code> at <code>ce183ced7f</code> for the newest round (earlier rounds at <code>9d6f721ec2</code>, <code>da4308dd82</code> and before), tests at <code>a0b9c92622</code> · 17 November 2026 · stack <code>che2e-by</code>, port 29409 · pull request <a href="https://github.com/macro-inc/macro/pull/10868">#10868</a> (ready for review, not merged)</p>');
sub(/<div class="verdict">.*?<\/div>/s, '<div class="verdict"><b>On <code>ce183ced7f</code>, all five whole runs with local sync on had nothing unexpected, and the three offline failures I reported are gone.</b> OFF-06, OFF-09 and OFF-13 held 90 of 90 repeats, and a new test that forces a page to be lost before the device kept what it read held 30 of 30. With local sync off, two of three whole runs were clean; the third had one failure, MSG-18, once in 33 tries and without a cause. The counts from earlier heads are kept below as they were.</div>');
sub(/<div class="tiles">.*?<\/div>\n<\/div>/s, `<div class="tiles">
<div class="tile"><b>5 of 5</b>whole runs clean, local sync on</div>
<div class="tile"><b>2 of 3</b>whole runs clean, local sync off</div>
<div class="tile"><b>90 of 90</b>repeats of OFF-06, OFF-09, OFF-13</div>
<div class="tile"><b>30 of 30</b>the forced cut-off (OFF-14)</div>
<div class="tile"><b>1</b>unexpected failure, unexplained</div>
</div>

<h2>The newest round: the owner's fixes</h2>
<p class="mut">B at <code>ce183ced7f</code>. Only web code changed since the last round, so the stack's services were left as they were; the cache engine passes the stale-engine check and both bundles were rebuilt. 164 tests. Load: one-minute average 21 to 60; seven bundle builds of mine ran during the first whole run.</p>
<div class="scroll"><table><thead><tr><th>Run</th><th>Load, start → end</th><th>Result</th><th>Unexpected</th></tr></thead><tbody>
<tr><td>On 1</td><td class="n">32 → 34</td><td>164 passed</td><td>none</td></tr>
<tr><td>On 2</td><td class="n">34 → 50</td><td>164 passed</td><td>none</td></tr>
<tr><td>On 3</td><td class="n">50 → 28</td><td>164 passed</td><td>none</td></tr>
<tr><td>On 4</td><td class="n">28 → 21</td><td>164 passed</td><td>none</td></tr>
<tr><td>On 5</td><td class="n">21 → 40</td><td>164 passed</td><td>none</td></tr>
<tr><td>Off 1</td><td class="n">38 → 55</td><td>128 passed, 35 skipped, 1 failed</td><td>MSG-18</td></tr>
<tr><td>Off 2</td><td class="n">55 → 61</td><td>129 passed, 35 skipped</td><td>none</td></tr>
<tr><td>Off 3</td><td class="n">61 → 58</td><td>129 passed, 35 skipped</td><td>none</td></tr>
</tbody></table></div>
<ul class="f">
<li><span class="tag t-some">once</span><b>MSG-18, local sync off.</b> Two people each sent four messages at the same moment; on one page a person's own messages showed as 1, 3, 2, 4. Not seen in any earlier run. Thirty repeats on each build afterwards: it did not show again. No cause found. Trace: <code>runs/f15-off-1/test-results/messages-MSG-18-…/trace.zip</code>.</li>
<li><span class="tag t-ok">fixed</span><b>OFF-06, OFF-09, OFF-13: 30 of 30 each</b> with local sync on. OFF-13 is no longer a known defect; OFF-06 is no longer marked as failing sometimes.</li>
<li><span class="tag t-ok">new test</span><b>OFF-14 forces the cut-off.</b> The device's engine is held back, so a page reads a thread from the services and cannot keep it. The app is then loaded again on another channel, the engine is let through, and the thread is opened with no connection. 30 of 30. Under a break that makes the next page ignore what an earlier page left noted, it fails while OFF-06 and OFF-09 pass.</li>
<li><span class="tag t-some">limit of the test</span><b>Nothing on screen says when the next page has kept the thread.</b> OFF-14 relies on the pause before the connection is lost, so it could fail on a slower machine without a defect.</li>
<li><span class="tag t-ok">proofs</span><b>The four missing break proofs exist.</b> DM-06: a typed name offers nobody. CHN-15 and MEM-03: a channel the services say is gone stays open; the marked check failed 14 of 14 and 4 of 4 under the break, against 7 of 13 and 0 of 3 without. CHN-08: its break stops the test at the Favorites step, before the deletion, so the deletion itself is still unproven.</li>
<li><span class="tag t-some">stale breaks</span><b>Four break patches no longer applied to this base.</b> They are rewritten and their 22 tests fail under them again. The other breaks apply but were not rebuilt on this head.</li>
<li><span class="tag t-some">not covered</span><b>With local sync off, a channel the cache knows now opens with no connection</b> and shows failing message reads. The offline tests are skipped on that build, so no test saw it.</li>
<li><span class="tag t-some">marked</span><b>Marked defects that showed in the eight runs:</b> ACC-06 in all eight, CHN-02 in five, CHN-15 in three, MSG-18 and THR-02 in two each, MEM-03, CHN-08, KEY-05 and UNR-04 in one each.</li>
</ul>`);
sub('<h2>The final round, on a new stack</h2>', '<h2>The round before the fixes, on <code>da4308dd82</code></h2>');
sub('<h2>The newest base: one flag</h2>', '<h2>The base before, <code>9d6f721ec2</code>: one flag</h2>');
sub(/<li><b>The newest base has one whole run on each build<\/b>.*?<\/li>\n<li><b>Four tests lost their known-defect mark.*?<\/li>\n<li><b>OFF-06 has no cause<\/b>.*?<\/li>/s, `<li><b>The newest head has five whole runs on and three off</b>, not ten, and none after the last suite commit (a title and ledger rows) or main's last commit.</li>
<li><b>MSG-18's one failure has no cause.</b></li>
<li><b>CHN-08's proof breaks its setup</b>, not the deletion it tests.</li>
<li><b>OFF-04's one whole-run failure on the old stack is still unexplained.</b></li>`);
sub(/<li><b>OFF-13's mark covers the whole test<\/b>.*?<\/li>\n/s, '');
sub('<p class="mut">Final round: <code>runs/f11-on-1</code>', '<p class="mut">Newest round: <code>runs/f15-on-1</code> to <code>-5</code>, <code>f15-off-1</code> to <code>-3</code>, <code>r15</code>, <code>r15b</code>, <code>m15off</code>, <code>m15on</code>, <code>bg2</code> to <code>bg5</code>, <code>breaks/results15.tsv</code>; loads in <code>logs/final15.log</code>. Round before: <code>runs/f11-on-1</code>');
writeFileSync(f, t);
