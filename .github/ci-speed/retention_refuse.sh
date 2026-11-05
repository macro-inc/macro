#!/usr/bin/env bash
# Proves a refusal still fails: real aws CLI exits 0 on per-key errors, the script must not.
set -uo pipefail
export AWS_ACCESS_KEY_ID=bench AWS_SECRET_ACCESS_KEY=bench AWS_DEFAULT_REGION=us-east-1 AWS_ENDPOINT_URL=http://127.0.0.1:5556
work=$(mktemp -d); dist=$work/dist; mkdir -p "$dist"
echo '{"schemaVersion":3,"bundleBuild":300}' >"$dist/bundle-manifest.json"; echo x >"$dist/index.html"
python3 .github/ci-speed/refuse_s3.py app/index.html,app/assets/retired.js 5556 & srv=$!
sleep 1
echo '{"Objects":[{"Key":"app/assets/retired.js"}],"Quiet":true}' >"$work/d.json"
aws s3api delete-objects --bucket bench --delete "file://$work/d.json" --query Errors --output json; echo "raw CLI exit=$?"
bash apps/web/scripts/retain-recent-builds.sh "$dist" s3://bench/app 10; status=$?
kill "$srv"
echo "RESULT refusal script_exit=$status" | tee -a "$GITHUB_STEP_SUMMARY"
[ "$status" != 0 ]
