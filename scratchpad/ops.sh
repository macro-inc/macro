#!/usr/bin/env bash
# ops.sh <N>: graphql operations of page trace N, with time, status and variables
f=$1-trace.network
jq -r '.snapshot | select(.request.method=="POST") | select(.request.url|test("graphql")) | [(.startedDateTime|.[11:23]), (.response.status|tostring), .request.postData._sha1, (.response.content._sha1 // "")] | @tsv' $f | sort | while IFS=$'\t' read -r t st req res; do
  op=$(jq -r '(.operationName // (.query|.[0:50])) + " " + (.variables|tostring|.[0:170])' resources/$req 2>/dev/null)
  echo "$t $st $op ${res:+res=$res}"
done
