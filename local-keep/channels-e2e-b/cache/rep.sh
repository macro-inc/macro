#!/usr/bin/env bash
# rep.sh <tag>: per test held/total for a repeat run, then every failed check with its trace.
d=$HOME/.cache/channels-e2e-b
jq -r '[.. | objects | select(has("specs")) | .specs[]] | .[] | (.title|split(" ")[0]) as $id | .tests[] | .expectedStatus as $e | .results[] | "\($id)\t\(.status)\t\(([.annotations[]?|select(.type=="intermittent-defect")|.description]|join(" ; ")) as $a | if $a=="" then "-" else $a end)\t\((.errors[0].message//"-")|split("\n")[0])\t\(.attachments|map(select(.name=="trace")|.path)|.[0]//"-")"' $d/runs/$1/playwright-report.json | sed 's/\x1b\[[0-9;]*m//g' > $d/$1.tsv
awk -F'\t' '{k=$1; t[k]++; if($2=="passed" && $3=="-") h[k]++} END{for(k in t) printf "%s %d/%d\n",k,h[k],t[k]}' $d/$1.tsv | sort | tr '\n' ' '; echo
awk -F'\t' '$2!="passed" || $3!="-" {print $1"\t"$2"\t"substr($3,1,150)"\t"substr($4,1,150)"\t"$5}' $d/$1.tsv | sed "s|$d/runs/$1/test-results/||"
