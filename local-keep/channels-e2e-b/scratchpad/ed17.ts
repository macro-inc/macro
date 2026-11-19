import { readFileSync, writeFileSync } from 'node:fs';
const s = process.argv[2];
let f = s + '/pr-body.md';
let t = readFileSync(f, 'utf8');
const sub = (a: string | RegExp, b: string) => { const n = t.replace(a, () => b); if (n === t) throw new Error('missing: ' + String(a).slice(0, 60)); t = n; };
sub('The base branch is merged in at `8e1a07f44b`.', 'The base branch is merged in at `9d6f721ec2`, and main after it.');
sub(/- The base now keeps channels on the device only with `VITE_ENABLE_CHANNEL_LOCAL_SYNC`[^\n]*\n/, '- The base removed the GraphQL sources flag and keeps channels on the device only with `VITE_ENABLE_CHANNEL_LOCAL_SYNC`, which has no default. The suite and its two CI jobs now tell their builds apart by that flag alone: "with the flag" means channel local sync on, and "without" is what ships until the rollout flag is turned on, with channel messages over REST.\n- Marks written for builds without the GraphQL sources named builds that no longer exist. Defects of those sources are now marked for both builds: UNR-10 as known; CHN-08, CHN-15, MEM-03, ACC-06, UNR-04, UNR-08 and DM-02 as failing in some runs. DM-06 is no longer a defect. These four have no break proof yet and their rows say so: CHN-08, CHN-15, MEM-03, DM-06.\n- Copying a link or a message\'s text no longer raises a toast on main, so CHN-06, NAV-07 and MSG-17 wait for the clipboard instead.\n');
sub('## Final round, on a new stack\n', `## On the newest base, one flag

At \`9d6f721ec2\`, engine rebuilt, on the same new stack with its services rebuilt from this head. One whole run on each build after the marks were moved:

- With channel local sync: 162 of 163 passed. Without (messages over REST, the first browser run of that path): 128 passed, 34 skipped, 1 failed.
- The one failure, on both builds, was CHN-08, and it was the test: its step for the channel menu clicked the menu's button while the menu was still open from the choice before, which closed it. With the step fixed, every CHN test four times on each build: 64 of 64 both times. No whole run was made after that fix, nor after main's last three commits were merged.
- In the run before the marks were moved, with channel local sync: OFF-09 failed once (a channel left as soon as its messages showed was empty with no connection). It held in the next run and in every run of the final round.
- Without the flag nothing failed that is not also seen with it: ACC-06, CHN-02, CHN-15 and MSG-18 showed their marked defects.
- A run made on the base before this one (\`8e1a07f44b\`) is void: the stack's services failed to rebuild, so a new web app ran against old services.

## Final round, on a new stack
`);
sub(' HEADNOTE', '');
sub('Not covered end to end: a build with the GraphQL flag and without channel local sync, ', 'Not covered end to end: ');
writeFileSync(f, t);

f = s + '/channels-device-proof.html';
t = readFileSync(f, 'utf8');
sub('at <code>da4308dd82</code> for the final round (base since merged at <code>8e1a07f44b</code>), tests at <code>HEADSHA</code>', 'at <code>da4308dd82</code> for the final round and <code>9d6f721ec2</code> for the last two runs, tests at <code>9ac132d74d</code>');
sub('Flag off passed three of three.</div>', 'Flag off passed three of three. On the newest base (<code>9d6f721ec2</code>, one flag) one whole run on each build had a single failure, the same test on both, and it was my test.</div>');
sub(' POSTMERGE</li>\n</ul>', `</li>
</ul>

<h2>The newest base: one flag</h2>
<p class="mut">B at <code>9d6f721ec2</code>, which removes the GraphQL sources flag and puts channels on the device behind <code>VITE_ENABLE_CHANNEL_LOCAL_SYNC</code> alone. Same new stack, its services rebuilt from this head, engine rebuilt. The suite now reads that one flag; "off" is what ships until the rollout flag is turned on, with messages over REST.</p>
<div class="scroll"><table><thead><tr><th>Build</th><th>Load, start → end</th><th>Result</th><th>Unexpected</th></tr></thead><tbody>
<tr><td>Local sync on</td><td class="n">33 → 24</td><td>162 of 163 passed</td><td>CHN-08</td></tr>
<tr><td>Local sync off (REST)</td><td class="n">22 → 30</td><td>128 passed, 34 skipped, 1 failed</td><td>CHN-08</td></tr>
</tbody></table></div>
<ul class="f">
<li><span class="tag t-ok">my test</span><b>CHN-08 failed on both builds because of its menu step.</b> After "Favorite" the channel menu can still be open; the step clicked the menu's button, which closed it, and then waited for "Delete". With the step fixed, every CHN test four times on each build: 64 of 64 both times. Traces: <code>runs/f14-on-1/test-results/channels-CHN-08-…/trace.zip</code>, <code>runs/f14-off-1/…</code>.</li>
<li><span class="tag t-some">once</span><b>OFF-09, local sync on:</b> in the run before the marks were moved, a channel left as soon as its messages showed was empty with no connection. It held in the next run and in all eleven of the final round. Trace: <code>runs/f13-on-1/test-results/offline-OFF-09-…/trace.zip</code>.</li>
<li><span class="tag t-ok">REST path</span><b>Nothing failed without the flag that does not also show with it.</b> ACC-06, CHN-02, CHN-15 and MSG-18 showed their marked defects.</li>
<li><span class="tag t-some">marks moved</span><b>Defects of the GraphQL sources now count for both builds,</b> since every build has them: UNR-10 as known; CHN-08, CHN-15, MEM-03, ACC-06, UNR-04, UNR-08 and DM-02 as failing in some runs. DM-06 is no longer a defect. Main no longer raises a toast for a copy, so three tests wait for the clipboard instead.</li>
<li><span class="tag t-some">void</span><b>A run on the base before this one</b> (<code>8e1a07f44b</code>) does not count: the services failed to rebuild, so the new web app ran against old services and 147 tests failed.</li>
</ul>`);
sub(/<li><b>The shipping default is not tested\.<\/b>.*?<\/li>/s, '<li><b>The newest base has one whole run on each build</b>, not ten, and none after the CHN-08 fix or after main\'s last three commits were merged into the tests\' branch.</li>\n<li><b>Four tests lost their known-defect mark and have no break proof yet:</b> CHN-08, CHN-15, MEM-03, DM-06.</li>');
sub('<code>f12-on-1</code>, <code>f12-off-1</code>; loads', '<code>f13-on-1</code>, <code>f13-off-1</code>, <code>f14-on-1</code>, <code>f14-off-1</code>, <code>v14</code>, <code>v14o</code>; loads');
writeFileSync(f, t);
