#!/usr/bin/env bash
# Builds and bundles the worker with wrangler's dry run, then hashes what would upload.
# No Cloudflare token exists in this job, so nothing can reach Cloudflare's write API.
set -euo pipefail
cd services/sync-service
if [ -n "${CLOUDFLARE_API_TOKEN:-}" ]; then echo "refusing: token present"; exit 9; fi
start=$(date +%s)
npm ci --silent
mid=$(date +%s)
npx wrangler deploy --dry-run --env dev --outdir "$RUNNER_TEMP/out"
end=$(date +%s)
bundle=$(\cd "$RUNNER_TEMP/out" && find . -type f -print0 | LC_ALL=C sort -z | xargs -0 sha256sum | sha256sum | cut -d' ' -f1)
config=$(cat wrangler.toml package-lock.json | sha256sum | cut -d' ' -f1)
migr=$(git ls-tree -r HEAD database | sha256sum | cut -d' ' -f1)
echo "RESULT sha=$(git rev-parse --short=12 HEAD) label=$LABEL attempt=$ATTEMPT npm_s=$((mid-start)) bundle_s=$((end-mid)) bundle=${bundle:0:16} config=${config:0:12} migrations=${migr:0:12} files=$(find "$RUNNER_TEMP/out" -type f | wc -l)" | tee -a "$GITHUB_STEP_SUMMARY"
