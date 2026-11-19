#!/usr/bin/env bash
# video-index.sh <commit>: write index.html for the recorded runs (report-on, report-off) to stdout.
R=$HOME/.cache/channels-e2e/runs
rows() { jq -c '[.. | objects | select(has("tests") and has("ok"))] | map({key: .title, value: {id, file,
  expected: .tests[0].expectedStatus, status: .tests[0].results[0].status, outcome: .tests[0].status,
  seconds: ((.tests[0].results[0].duration // 0) / 1000 | round),
  videos: ([.tests[0].results[0].attachments[] | select(.name == "video")] | length),
  noted: ([.tests[0].annotations[]? | select(.type == "intermittent-defect")] | length)}}) | from_entries' "$1"; }
jq -rn --argjson on "$(rows $R/24909-video/playwright-report.json)" --argjson off "$(rows $R/22609-video/playwright-report.json)" \
   --argjson son "$(jq .stats $R/24909-video/playwright-report.json)" --argjson soff "$(jq .stats $R/22609-video/playwright-report.json)" --arg commit "$1" '
def esc: gsub("&"; "&amp;") | gsub("<"; "&lt;") | gsub(">"; "&gt;");
def cell($dir): if . == null then "<td>not run</td>" else
  (if .outcome == "unexpected" then ["bad", "FAILED (" + .status + ")"]
   elif .expected == "failed" then ["known", "fails, as recorded: known defect of main"]
   elif .noted > 0 then ["known", "passed; intermittent defect of main showed"]
   else ["ok", "passed"] end) as [$class, $text]
  | "<td class=\"\($class)\">\($text)<br><a href=\"\($dir)/index.html#?testId=\(.id)\">watch (\(.videos) video\(if .videos == 1 then "" else "s" end), \(.seconds) s)</a></td>" end;
def tally($s; $rows): "\($s.expected) as expected, \($s.unexpected) failed" +
  " (\([$rows[] | select(.expected == "failed" and .outcome == "expected")] | length) of those expected are the recorded defects of main failing as recorded)";
"<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">
<title>Channels suite videos</title><style>
:root{--bg:#f7f6f2;--fg:#1d1f23;--muted:#5d636d;--line:#dcd9d0;--surface:#fff;--ok:#1d6b3a;--bad:#b3261e;--known:#8a5a00;--accent:#2f5fd0}
@media (prefers-color-scheme:dark){:root{--bg:#15171a;--fg:#e8e9eb;--muted:#a0a6b0;--line:#33373e;--surface:#1d2024;--ok:#7fd59b;--bad:#ff9b93;--known:#f0c76a;--accent:#8fb0ff;color-scheme:dark}}
body{background:var(--bg);color:var(--fg);font:15px/1.55 system-ui,sans-serif;margin:24px 16px 64px}main{max-width:1100px;margin:0 auto}
h1{font-size:26px;margin:0 0 8px}p,li{max-width:75ch}a{color:var(--accent)}.muted{color:var(--muted)}
.scroll{overflow-x:auto;border:1px solid var(--line);border-radius:10px;background:var(--surface)}table{border-collapse:collapse;width:100%;font-size:14px}
th,td{text-align:left;vertical-align:top;padding:8px 12px;border-bottom:1px solid var(--line)}th{color:var(--muted);font-size:12px;text-transform:uppercase}
td.ok{color:var(--ok)}td.bad{color:var(--bad);font-weight:600}td.known{color:var(--known)}td.id{white-space:nowrap;font-weight:600}
</style></head><body><main>
<h1>Channels end-to-end suite: a video of every test</h1>
<p class=\"muted\">One whole-suite run on each build of main, every test recorded. Commit \($commit), 16 November 2026, two workers.</p>
<ul>
<li><b>main with the GraphQL sources flag on</b>: \(tally($son; $on)). <a href=\"flag-on/index.html\">Whole report</a></li>
<li><b>main, flag off (as production is built)</b>: \(tally($soff; $off)). <a href=\"flag-off/index.html\">Whole report</a></li>
</ul>
<p>Each link opens that test in Playwright’s report: its videos are at the bottom of the page (one per person’s browser window: the first is the default person, the others are the teammates the test opens), with the steps above and a Traces link for a step-by-step replay. A test marked as a known defect asserts what should happen, fails on main today, and is recorded as such; it turns the run red when the defect is fixed.</p>
<div class=\"scroll\"><table><tr><th>Test</th><th>What it checks</th><th>Flag on</th><th>Flag off</th></tr>
\([($on + $off) | keys[] | . as $t | "<tr><td class=\"id\">\($t | split(" ")[0])</td><td>\($t | sub("^[A-Z]+-[0-9]+ "; "") | esc)<br><span class=\"muted\">\(($on[$t] // $off[$t]).file)</span></td>\($on[$t] | cell("flag-on"))\($off[$t] | cell("flag-off"))</tr>"] | join("\n"))
</table></div></main></body></html>"'
