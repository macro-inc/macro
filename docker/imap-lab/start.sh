#!/usr/bin/env bash
set -euo pipefail
lab_dir="$(\cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
bash "$lab_dir/prepare.sh"
compose=(docker compose -p macro-imap-lab -f "$lab_dir/compose.yaml")
"${compose[@]}" up -d --wait --wait-timeout 90 dovecot mailpit localstack
if ! "${compose[@]}" exec -T localstack awslocal kms describe-key --key-id alias/macro-local-imap-credentials >/dev/null 2>&1; then
    key_id="$("${compose[@]}" exec -T localstack awslocal kms create-key --query KeyMetadata.KeyId --output text)"
    "${compose[@]}" exec -T localstack awslocal kms create-alias --alias-name alias/macro-local-imap-credentials --target-key-id "$key_id"
fi
python3 "$lab_dir/check.py"
