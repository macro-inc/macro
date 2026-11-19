import { readFileSync, writeFileSync } from 'node:fs';
let b = readFileSync('/tmp/claude-1001/-home-teo--herdr-worktrees-macro-synoet-channels-e2e-b/b49c4b7f-8cbd-4769-b69a-a9246e0bd07f/scratchpad/pr-body.md', 'utf8');
const m = "Main with the flag on does the same (6 of 20 on people who had run little; 9 of 20 on this branch's base).";
if (!b.includes(m)) throw new Error('pr');
b = b.replace(m, 'It happens on main with the flag on too (6 of 20) as on this build (9 of 20), both on people who had run little.');
writeFileSync('/tmp/claude-1001/-home-teo--herdr-worktrees-macro-synoet-channels-e2e-b/b49c4b7f-8cbd-4769-b69a-a9246e0bd07f/scratchpad/pr-body.md', b);
const f = '/tmp/claude-1001/-home-teo--herdr-worktrees-macro-synoet-channels-e2e-b/b49c4b7f-8cbd-4769-b69a-a9246e0bd07f/scratchpad/channels-device-proof.html';
let t = readFileSync(f, 'utf8');
const cut = (from: string, to: string, w: string) => {
  const a = t.indexOf(from), z = t.indexOf(to, a);
  if (a < 0 || z < 0) throw new Error('missing ' + from.slice(0, 30));
  t = t.slice(0, a) + w + t.slice(z);
};
cut('<div class="verdict">', '<div class="tiles">', `<div class="verdict"><b>The two unexplained failures have causes, and neither is B.</b> MEM-01 was my test: the invite row changes under the click, on main with the flag on too. CHN-03 is a defect on both builds that my stack's growth exposed: a rename saved while the page is still reading its list of channels never reaches the header. With both fixed, one whole run on each build had nothing unexpected. Of the twenty flag-on runs before, eleven were clean; one failure in them is B's (OFF-04, a long channel not loaded offline), which showed again 4 times in 30 and left no new trace.</div>

`);
cut('<h2>Twenty runs with the flag on', '<h2>Twenty runs with the flag on', `<h2>The causes of MEM-01 and CHN-03</h2>
<ul class="f">
<li><span class="tag t-ok">my test</span><b>MEM-01: the dialog does not close. Its one row is replaced.</b> The row reads "Invite &lt;address&gt;" until the device's own list of people answers; if it knows the address the row becomes that person's, sometimes as it is being clicked. The test looked for the row by its first name and lost it. Either row invites the person, so nothing is wrong for someone using it. Main with the flag on does the same: 6 of 20 there, 9 of 20 on this build, both on people who had run little, and 0 of 20 on the much-used people. With the row found by the address: 20 of 20, then 30 of 30 and 12 of 12 among other tests. I said last time the dialog closed by itself; that was wrong.</li>
<li><span class="tag t-bad">both builds</span><b>CHN-03: a rename saved while the page is still reading its list of channels never reaches the header.</b> A page reads its whole list, a hundred channels to a request, after every load. A part of the list answered before the rename puts the old name back, and the list is not read again until a reload. With a handful of channels the read is over before anyone can rename; the people of my stack had over 4,000 each after some fifty runs (43 requests, three to six seconds), so the test's rename always fell inside it. None of my test edits or the merge caused it: the unchanged test held 6 of 6 on people with few channels on the same build, and failed 7 of 9 on the much-used ones.</li>
<li><span class="tag t-ok">new test</span><b>CHN-16 shows the defect without thousands of channels,</b> by holding the list's answer back while the rename is saved: the header kept the old name for a minute and showed the new one after a reload, on this build flag on, flag off, and main with the flag on. It is marked a known defect on both builds. CHN-03 now waits for the list first: 30 of 30 and 12 of 12 flag on, 10 of 10 flag off.</li>
<li><span class="tag t-ok">after the fixes</span><b>One whole run on each build with nothing unexpected:</b> 162 passed flag on (load 20 to 16); 129 passed, 33 skipped flag off (load 32 to 31). Every CHN and MEM test thirty times flag on and ten flag off, together with OFF-04.</li>
<li><span class="tag t-some">1 of 30 each, flag on</span><b>CHN-07 and MEM-03 failed once each in those repeats:</b> a channel its owner deleted kept its composer, and a removed person kept the channel. Neither in 12 more repeats or flag off. Not traced to a cause; both are a list catching up late, and the same much-used people. Traces: <code>runs/r10-on/test-results/channels-CHN-07-…-repeat9/trace.zip</code>, <code>members-MEM-03-…-repeat13/trace.zip</code>.</li>
<li><span class="tag t-bad">B, no new trace</span><b>OFF-04 showed 4 times in 30 in that mix,</b> where its mark keeps no trace, and then not once in 36 repeats with every trace kept (16 on little-used people, 8 and 12 on the much-used). The one trace is still <code>runs/f7-on-8</code>; its console shows only the lost connection.</li>
</ul>

`);
const np = '<li><b>MEM-01 and CHN-03 are unexplained.</b>';
const a = t.indexOf(np), z = t.indexOf('</li>', a) + 5;
if (a < 0) throw new Error('np');
t = t.slice(0, a) + '<li><b>OFF-04 has no cause yet</b>, and CHN-07 and MEM-03 failed once each in thirty without one.</li>\n<li><b>The stack was never emptied between runs.</b> Its people had over 4,000 channels each by the end, which no earlier round had; a later round should start from a new stack.</li>' + t.slice(z);
t = t.replace('<b>MEM-01: the invite dialog closed by itself.</b>', '<b>MEM-01: the invite row was lost (cause above; my test).</b>');
t = t.replace('tests at <code>1c6210f267</code>', 'tests at <code>HEADSHA</code>');
writeFileSync(f, t);
