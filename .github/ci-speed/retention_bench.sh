#!/usr/bin/env bash
# Runs a real retain-recent-builds.sh with the real aws CLI against a local S3 server.
# usage: retention_bench.sh <old|new> <attempt> <retired-keys>
set -euo pipefail
arm=$1; attempt=$2; n=$3
export AWS_ACCESS_KEY_ID=bench AWS_SECRET_ACCESS_KEY=bench AWS_DEFAULT_REGION=us-east-1 AWS_ENDPOINT_URL=http://127.0.0.1:5555
# Nothing here may reach AWS: the only endpoint is this runner, and no secret is in the environment.
case "$AWS_ENDPOINT_URL" in http://127.0.0.1:*) ;; *) exit 9 ;; esac
work=$(mktemp -d); dist=$work/dist; mkdir -p "$dist"
echo '{"schemaVersion":3,"bundleBuild":300}' >"$dist/bundle-manifest.json"; echo x >"$dist/index.html"
script=apps/web/scripts/retain-recent-builds.sh
if [ "$arm" = old ]; then git show "$BASE_SHA:$script" >"$work/s.sh"; else cp "$script" "$work/s.sh"; fi
moto_server -H 127.0.0.1 -p 5555 >/dev/null 2>&1 & srv=$!
for _ in $(seq 60); do curl -sf http://127.0.0.1:5555/moto-api/ >/dev/null && break; sleep 0.5; done
python3 - "$n" <<'PY'
import boto3, sys
n = int(sys.argv[1]); s = boto3.client('s3'); s.create_bucket(Bucket='bench')
for i in range(n): s.put_object(Bucket='bench', Key=f'app/assets/retired-{i:05d}-hash.js', Body=b'')
for k in ['app/index.html', 'app/bundle-manifest.json', 'app/assets/kept.js']: s.put_object(Bucket='bench', Key=k, Body=b'')
for b in range(291, 300): s.put_object(Bucket='bench', Key=f'app/_builds/{b}.txt', Body=b'app/assets/kept.js\n')
PY
start=$(date +%s.%N); status=0
bash "$work/s.sh" "$dist" s3://bench/app 10 || status=$?
secs=$(python3 -c "import time;print(round(time.time()-$start,2))")
left=$(aws s3api list-objects-v2 --bucket bench --prefix app/assets/ --query 'Contents[].Key' --output text | tr '\t' '\n' | grep -c retired || true)
kept=$(aws s3api list-objects-v2 --bucket bench --prefix app/assets/kept --query 'length(Contents)' --output text)
kill "$srv" || true
echo "RESULT arm=$arm attempt=$attempt retired=$n seconds=$secs exit=$status retired_left=$left kept=$kept aws=$(aws --version 2>&1 | cut -d' ' -f1)" | tee -a "$GITHUB_STEP_SUMMARY"
[ "$status" = 0 ] && [ "$left" = 0 ] && [ "$kept" = 1 ]
