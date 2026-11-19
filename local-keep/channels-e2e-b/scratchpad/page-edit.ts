const path = process.argv[2];
let t = await Bun.file(path).text();
const rep = (a: string, b: string) => { if (!t.includes(a)) throw new Error('no match: ' + a.slice(0, 40)); t = t.replace(a, b); };
rep('at <code>b7023c79d8</code> today,', 'at <code>92835f2c2a</code> now, <code>b7023c79d8</code> earlier today,');
rep('tests at <code>a386ce3c92</code> ·', 'tests at <code>2266cb5eec</code> ·');
rep('<div class="verdict"><b>Today, after the breaks left the suite', `<div class="verdict"><b>Latest, on the merged head: both whole runs had nothing unexpected (164 passed with local sync on; 129 passed, 35 skipped off), and UNR-06's cause is found.</b> The Mute notifications submenu sometimes builds its entries again while open; the one holding the keyboard is removed and Enter goes to the page. It shows on both builds (7 of 250 on, 2 of 150 off), so it is a defect of main, now recorded as intermittent. One thing is open: on casts worn by today's repeats a new message sometimes left no unread dot.</div>

<div class="verdict"><b>Earlier today, after the breaks left the suite`);
rep('<h2>Today: the breaks leave the suite</h2>', `<h2>Latest: UNR-06's cause, and the merged head</h2>
<p class="mut">Whole runs at <code>596c31be38</code> (base <code>92835f2c2a</code> and main merged, no conflicts); the pushed head <code>2266cb5eec</code> adds one line to UNR-06. Services updated in place, data kept. Load: one-minute average 34 to 93.</p>
<div class="scroll"><table><thead><tr><th>Run</th><th>Result</th><th>Unexpected</th><th>Marked defects that showed</th></tr></thead><tbody>
<tr><td>Local sync on</td><td>164 passed</td><td>none</td><td>ACC-06, CHN-08, UNR-04</td></tr>
<tr><td>Local sync off</td><td>129 passed, 35 skipped</td><td>none</td><td>ACC-06, CHN-02, MEM-03, MSG-18</td></tr>
</tbody></table></div>
<ul class="f">
<li><span class="tag t-ok">cause</span><b>UNR-06: the submenu's entries are built again while it is open.</b> Since the "Only @mentions" entry, the list of entries reads one of the menu's properties while it is built, so it is rebuilt whenever those properties are recomputed. Each entry becomes a new element; the one holding the keyboard is removed, focus falls to the page, and Enter chooses nothing. A probe logging focus, keys and removed elements saw this in every failure: entries removed and added between the focus and the key, and the key delivered to the page body.</li>
<li><span class="tag t-some">both builds</span><b>7 of 250 with local sync on, 2 of 150 off.</b> The entries were remade while the submenu was open in about one run in nine on either build; it fails only when that falls between focus and key. It is neither the new entry taking focus nor the menu's key handling, and it does not tell the builds apart. What recomputes the properties at that moment was not traced.</li>
<li><span class="tag t-ok">recorded</span><b>UNR-06 notes the first attempt as an intermittent defect, chooses again, and still asserts the bell.</b> No app code changed. The lists now hold 10 known and 17 intermittent defects.</li>
<li><span class="tag t-some">open</span><b>A new message sometimes left no unread dot in the sidebar, on worn casts.</b> In repeats on the four casts that ran hundreds of tests today: UNR-06 4 of 120, UNR-02 2 of 37, UNR-07 1 of 37 with local sync on; UNR-02 1 of 25 off. On the two casts that have run little, the same tests held 120 of 120 with local sync on, but with half the workers, so the worn casts are suspected and not proven. Not marked.</li>
</ul>

<h2>Earlier today: the breaks leave the suite</h2>`);
rep('Cause not established; the test is not marked. Trace:', 'Cause: see the section above. Trace:');
await Bun.write(path, t);
