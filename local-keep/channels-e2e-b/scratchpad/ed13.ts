import { readFileSync, writeFileSync } from 'node:fs';
const f = process.argv[2];
let t = readFileSync(f, 'utf8');
const sub = (a: string | RegExp, b: string) => { const n = t.replace(a, () => b); if (n === t) throw new Error('missing: ' + String(a).slice(0, 50)); t = n; };
sub(/<p class="mut">Approach B, flag on, branch[^\n]*<\/p>/, '<p class="mut">Approach B, flag on, branch <code>synoet/channels-local-sync-pr5-writes</code> at <code>da4308dd82</code> for the final round (base since merged at <code>8e1a07f44b</code>), tests at <code>HEADSHA</code> · 17 November 2026 · new stack <code>che2e-by</code>, port 29409 · pull request <a href="https://github.com/macro-inc/macro/pull/10868">#10868</a> (ready for review, not merged)</p>');
sub(/<div class="verdict">.*?<\/div>/s, '<div class="verdict"><b>On a new stack, B still does not pass clean: two of ten flag-on runs had nothing unexpected.</b> Three tests failed in the others. Two are not B\'s: a removed person keeping the channel (MEM-03) and a first-ever direct message not reaching the other person\'s list (DM-02) both show on main\'s own code with the flag. One is B\'s and new on this head: a long thread showing three replies offline (OFF-06, 4 of 10). The "Conversation unavailable" failure reproduces and has a cause: offline after a reload, a held channel is lost once about a hundred others are newer. Flag off passed three of three.</div>');
sub(/<div class="tiles">.*?<\/div>\n<\/div>/s, `<div class="tiles">
<div class="tile"><b>10 + 3</b>whole runs flag on and flag off on the new stack</div>
<div class="tile"><b>2</b>of 10 flag-on runs with nothing unexpected</div>
<div class="tile"><b>3</b>tests behind every failure; 1 is B's alone</div>
<div class="tile"><b>~100</b>newer channels before a held one is lost offline</div>
<div class="tile"><b>3 of 3</b>flag-off runs clean</div>
</div>`);
sub('<h2>The causes of MEM-01 and CHN-03</h2>', `<h2>The final round, on a new stack</h2>
<p class="mut">B at <code>da4308dd82</code>, engine rebuilt, stale-engine check on. Stack <code>che2e-by</code> (proxy port 29409) was started empty and seeded for this round; the old stack was left as it was. Nothing else ran on the new stack, but the machine was shared: one-minute load 19 to 41 during runs 1 to 9. A tenth run is void, because pages crashed in twelve tests while another job took the load to 143; a replacement run passed all 162 at load 45 to 54.</p>
<div class="scroll"><table><thead><tr><th>Test</th><th>Whole runs, flag on (10)</th><th>Thirty repeats, B</th><th>Thirty repeats, main's code with the flag</th><th>Flag off</th></tr></thead><tbody>
<tr><td>MEM-03, a removed person keeps the channel</td><td class="warn">failed 5</td><td>failed 1</td><td>failed 2</td><td>known defect, every run</td></tr>
<tr><td>DM-02, a first-ever direct message missing from the other's list</td><td class="warn">failed 4, once for each set of people</td><td>not repeated</td><td>failed 1 of 1 first time</td><td>held 1 of 1 first time</td></tr>
<tr><td>OFF-06, a long thread offline</td><td class="warn">failed 4</td><td>not repeated</td><td>main keeps nothing offline</td><td>skipped</td></tr>
<tr><td>OFF-12, back to an old message offline</td><td>held 10</td><td class="warn">held the first 17, failed 12 of the last 13</td><td>failed 30</td><td>skipped</td></tr>
<tr><td>OFF-04, long history offline (marked)</td><td>held 10</td><td class="warn">showed 8, from the same minute as OFF-12</td><td>failed 30</td><td>skipped</td></tr>
<tr><td>CHN-07, a deleted channel closes</td><td>held 10</td><td>held 30</td><td>held 30</td><td>held 3</td></tr>
</tbody></table></div>
<p class="mut">"main's code with the flag" is a bundle of main at the merge-base <code>09f9124b55</code>, built with the flag and served from the same new stack.</p>
<ul class="f">
<li><span class="tag t-bad">B, has a cause</span><b>"Conversation unavailable" reproduces, and it is a limit of about a hundred channels.</b> With no connection after a reload, a channel the device holds opens while fewer than about a hundred of the person's other channels are newer, and says "Conversation unavailable" beyond that: it opened with 95 newer and not with 120, and leaving the device alone for 30 seconds first changed nothing. Thirty repeats make over a hundred channels for each person, which is why OFF-12 and OFF-04 held at first and then failed together. In whole runs OFF-12 held every time. main's code opens no channel offline at all, so this is a limit of the new behaviour and not something main does better. New test OFF-13, marked a known defect.</li>
<li><span class="tag t-bad">B, new on this head</span><b>OFF-06: a long thread read while connected showed only its first three replies offline,</b> in 4 of 10 runs and once more later. It held in all twenty runs on the head before. I did not trace it further. Trace: <code>runs/f11-on-3/test-results/offline-OFF-06-…/trace.zip</code>.</li>
<li><span class="tag t-some">main too</span><b>MEM-03: a removed person kept the channel and its composer</b> in 5 of 10 whole runs, far more than the once in thirty of the repeats. main's code with the flag does it too (2 of 30), and without the flag it happens every time, which the suite already records. So the flag makes an existing defect rarer; B does not cause it. Traces: <code>runs/f11-on-1/test-results/members-MEM-03-…/trace.zip</code>, <code>runs/r11-main/test-results/members-MEM-03-…-repeat2/trace.zip</code>.</li>
<li><span class="tag t-some">main too</span><b>DM-02: two people's first conversation does not reach the other person's open list.</b> It failed exactly once for each of the four sets of people, on their first run, and never after: the conversation then exists for the life of the stack, so no earlier round on the old stack could see it. main's code with the flag failed the same way for people who had never run it; without the flag the row showed at once. Trace: <code>runs/f11-on-1/test-results/direct-messages-DM-02-…/trace.zip</code>.</li>
<li><span class="tag t-ok">held</span><b>CHN-07 did not fail</b> in 30 repeats on B or on main's code, nor in any whole run.</li>
<li><span class="tag t-ok">after the marks</span><b>One whole run on each build:</b> 163 passed flag on; 129 passed, 34 skipped flag off. POSTMERGE</li>
</ul>

<h2>The causes of MEM-01 and CHN-03 (round before)</h2>`);
sub('<h2>Twenty runs with the flag on, five with it off</h2>', '<h2>Earlier: twenty runs with the flag on, five with it off (old stack)</h2>');
sub('<li><b>OFF-04:</b> the owner\'s fix held 21 of 21, then failed once in the next fifteen runs. Better, not gone.</li>', `<li><b>OFF-04:</b> held in all ten whole runs on the new head. What showed in repeats is the hundred-channel limit, not the gap the owner fixed.</li>
<li><b>MEM-03 and CHN-07 on main:</b> I agree for MEM-03 (2 of 30 on main's code). CHN-07 I could not make fail on either build.</li>
<li><b>"Conversation unavailable":</b> I agree main fails it, but main opens nothing offline, so that comparison says little. On B it is the hundred-channel limit above; in whole runs here OFF-12 held 11 of 11, so I did not reproduce the owner's whole-run failure.</li>`);
sub(/<li><b>The machine was never idle<\/b>.*?<li><b>PRE-05/s, `<li><b>The machine was never idle</b>: other sessions kept its load between 19 and 86, and one run is void for it.</li>
<li><b>The shipping default is not tested.</b> The base now puts channels on the device behind a rollout flag of its own (<code>enable-channel-local-sync</code>, off by default). The suite tests both flags on and both off, not the GraphQL flag alone.</li>
<li><b>OFF-06 has no cause</b>, and OFF-04's one whole-run failure on the old stack is still unexplained.</li>
<li><b>DM-02 can be seen once for each set of people on a stack</b>, so its count is small: 4 of 4 on B, 1 of 1 on main's code, 0 of 1 flag off.</li>
<li><b>OFF-13's mark covers the whole test</b>, including making its 120 channels; I ran it once without the mark and it failed at the right step.</li>
<li><b>PRE-05`);
sub('<p class="mut">Evidence is under', '<p class="mut">Final round: <code>runs/f11-on-1</code> to <code>-11</code>, <code>f11-off-1</code> to <code>-3</code>, <code>r11-on</code>, <code>r11-main</code>, <code>pold</code>, <code>dm2-off</code>, <code>dm2-main</code>, <code>f12-on-1</code>, <code>f12-off-1</code>; loads in <code>logs/final11.log</code>. Evidence is under');
writeFileSync(f, t);
