#!/usr/bin/env bash
# Sum a differential run (run.sh) into summary.json and summary.md in its
# output directory. A difference is "kept" when no known cause explained it
# (classify.mjs); a mutant is caught when its runs keep at least one difference
# or live regression while the unmutated runs keep none.
#   proof-v2/summarize.sh <out-dir>
set -euo pipefail
out="${1:?usage: summarize.sh <out-dir>}"
jq=(nix shell nixpkgs#jq --command jq)

summaries=()
for f in "$out"/*/read-summary.json "$out"/*/seq-summary.json; do
  [ -f "$f" ] && summaries+=("$f")
done
[ "${#summaries[@]}" -gt 0 ] || { echo "no summaries under $out" >&2; exit 1; }

"${jq[@]}" -n --slurpfile all <(for f in "${summaries[@]}"; do
  "${jq[@]}" -c --arg run "$(basename "$(dirname "$f")")" '. + {run: $run}' "$f"
done) '
  def causes: [.classifiedSummary // {} | to_entries[] | .value | to_entries[] | {cause: .key, count: .value.count}];
  def readrow: {
    run, seed, mutant,
    viewers: .totals.viewers, specs: .totals.specs, cases: .totals.perIdComparisons,
    kept: (.totals.contractDiffs + .totals.dataDiffs),
    dataDiffs: .totals.dataDiffs, contractDiffs: .totals.contractDiffs,
    classified: (.totals.classified // 0), loadFailures: .totals.loadFailures,
    lastViewWrong: .totals.lastViewWrong, causes: causes, commits
  };
  def seqrow: {
    run, seed, mutant, liveMs,
    groups: [.groups[].label],
    sequences: ([.groups[].totals.sequences] | add),
    steps: ([.groups[].totals.steps] | add),
    reloads: ([.groups[].totals.reloads // 0] | add),
    refused: ([.groups[].totals.refused] | add),
    rawDiffs: ([.groups[].totals.rawDiffs] | add),
    reloadDataDiffs: ([.groups[].totals.reloadDataDiffs] | add),
    reloadContractDiffs: ([.groups[].totals.reloadContractDiffs] | add),
    liveRegressions: ([.groups[].totals.liveRegressions[]]),
    liveTimeouts: ([.groups[].totals.liveTimeouts | to_entries[]] | group_by(.key) | map({key: .[0].key, value: (map(.value) | add)}) | from_entries),
    liveP95Max: ([.groups[].totals.liveMs | to_entries[] | {key, value: .value.p95}] | group_by(.key) | map({key: .[0].key, value: (map(.value) | max)}) | from_entries),
    classified: ([.groups[].totals.classified] | add),
    lastViewWrong: ([.groups[].totals.lastViewWrong | to_entries[]] | length),
    causes: [.groups[] | causes[]] | group_by(.cause) | map({cause: .[0].cause, count: (map(.count) | add)}),
    commits
  } | . + {kept: (.rawDiffs + .reloadDataDiffs + .reloadContractDiffs + (.liveRegressions | length))};
  ($all | map(select(.phase == "read")) | map(readrow)) as $reads
  | ($all | map(select(.phase == "seq")) | map(seqrow)) as $seqs
  | ($reads | map(select(.mutant == null))) as $baseReads
  | ($seqs | map(select(.mutant == null))) as $baseSeqs
  | {
      commits: ([$all[].commits] | unique),
      reads: $baseReads,
      sequences: $baseSeqs,
      totals: {
        readSeeds: ($baseReads | map(.seed) | unique),
        readCases: ($baseReads | map(.cases) | add),
        readSpecs: ($baseReads | map(.specs) | add),
        sequences: ($baseSeqs | map(.sequences) | add),
        steps: ($baseSeqs | map(.steps) | add),
        kept: (($baseReads | map(.kept) | add // 0) + ($baseSeqs | map(.kept) | add // 0))
      },
      mutants: (
        ($reads + $seqs) | map(select(.mutant != null)) | group_by(.mutant)
        | map({mutant: .[0].mutant, kept: (map(.kept) | add), runs: map({run, kept})}
              | . + {caught: (.kept > 0)})
      )
    }
' > "$out/summary.json"

"${jq[@]}" -r '
  "# Channel directory differential\n",
  "Commits: " + (.commits | map("main \(.main[0:11]) / branch \(.branch[0:11])") | join(", ")),
  "",
  "Read cases: \(.totals.readCases) per-id comparisons in \(.totals.readSpecs) specs, seeds \(.totals.readSeeds | join(", "))",
  "Sequences: \(.totals.sequences) of \(.totals.steps) steps in all",
  "Kept differences (no known cause): \(.totals.kept)",
  "",
  "| run | seed | cases/steps | kept | data | contract/raw | classified | live regressions | timeouts M/C/N | p95 max C/N ms |",
  "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  (.reads[] | "| \(.run) | \(.seed) | \(.cases) | \(.kept) | \(.dataDiffs) | \(.contractDiffs) | \(.classified) | - | - | - |"),
  (.sequences[] | "| \(.run) | \(.seed) | \(.sequences)x, \(.steps) steps | \(.kept) | \(.reloadDataDiffs) | \(.reloadContractDiffs)/\(.rawDiffs) | \(.classified) | \(.liveRegressions | length) | \(.liveTimeouts.M // 0)/\(.liveTimeouts.C // 0)/\(.liveTimeouts.N // 0) | \(.liveP95Max.C // "-")/\(.liveP95Max.N // "-") |"),
  "",
  "## Mutants: \([.mutants[] | select(.caught)] | length) of \(.mutants | length) caught",
  (.mutants[] | "- \(.mutant): \(if .caught then "caught" else "MISSED" end), \(.kept) kept (\(.runs | map("\(.run) \(.kept)") | join(", ")))"),
  "",
  "## Known causes (classified, not kept)",
  ([.reads[].causes[], .sequences[].causes[]] | group_by(.cause) | map("- \(.[0].cause): \(map(.count) | add)") | .[])
' "$out/summary.json" > "$out/summary.md"
cat "$out/summary.md"
