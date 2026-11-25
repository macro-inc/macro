# On the in-VPC migrator runner: presign the image's files for the hosts,
# record the upgrade in the environment's database through hosted_runtimes'
# image-upgrade binary, and wait while the control plane carries it out.
set -euo pipefail

fail() {
  echo "::error::$1"
  exit 1
}

[ "$ENVIRONMENT" = "dev" ] || fail "environment must be dev"
command -v jq >/dev/null || fail "jq is missing on this runner"

[[ "${NIX_CACHE_URL:-}" =~ ^s3://([a-z0-9.-]+)\?(.*&)?region=([a-z0-9-]+) ]] \
  || fail "the NIX_CACHE_URL repository variable is not an s3:// URL with a region"
bucket=${BASH_REMATCH[1]}
region=${BASH_REMATCH[3]}
prefix="firecracker-images/$IMAGE_VERSION"
files="$FILES_DIR/files.json"
[ -s "$files" ] || fail "the build job's digests are missing"

# The runner's own temp directory: emptied at the start of every job, so a
# job killed before its trap still leaves nothing for the next one.
secrets=$(mktemp -d "$RUNNER_TEMP/rollout.XXXXXX")
chmod 700 "$secrets"
trap 'rm -rf "$secrets"' EXIT

# Six hours: the hosts download within the staging step; the URLs are
# dropped from the database once the image is staged.
sources='[]'
for name in vmlinux rootfs.ext4 boot_args; do
  # Named by its contents, as the build job uploaded it.
  # shellcheck disable=SC2016 # $name is jq's, not the shell's
  sha256=$(jq -r --arg name "$name" '.[] | select(.name == $name) | .sha256' "$files")
  [[ $sha256 =~ ^[0-9a-f]{64}$ ]] || fail "files.json has no SHA-256 for $name"
  url=$(AWS_DEFAULT_REGION=$region aws s3 presign --expires-in 21600 "s3://$bucket/$prefix/$sha256-$name.zst")
  echo "::add-mask::$url"
  sources=$(jq --arg name "$name" --arg url "$url" --slurpfile files "$files" \
    '. + [{file: ($files[0][] | select(.name == $name)), url: $url}]' <<<"$sources")
done
jq -n --arg image "$IMAGE_VERSION" --argjson sources "$sources" \
  '{image: $image, sources: $sources}' >"$secrets/manifest.json"

# The migrator's own credentials read the database URL; the image bucket's
# keys are not needed for it.
database_url=$(env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY \
  aws secretsmanager get-secret-value --secret-id macro-db-dev --query SecretString --output text)
if [[ "$database_url" != *"sslmode="* ]]; then
  if [[ "$database_url" == *"?"* ]]; then database_url="$database_url&sslmode=require"; else database_url="$database_url?sslmode=require"; fi
fi
echo "::add-mask::$database_url"
printf '%s' "$database_url" >"$secrets/database.url"

cargo build --release --locked -p hosted_runtimes --features image-upgrade-cli --bin image-upgrade
bin=target/release/image-upgrade

upgrade_id=$("$bin" start --environment dev --database-url-file "$secrets/database.url" \
  --manifest "$secrets/manifest.json" --computers "$COMPUTERS" --batch-size "$BATCH_SIZE" \
  --idle-wait-minutes "$IDLE_WAIT_MINUTES" --reconnect-timeout-minutes "$RECONNECT_TIMEOUT_MINUTES" \
  --created-by "$RUN_URL")
echo "upgrade $upgrade_id recorded"

# Idle wait, plus per computer a replacement and a reconnect window, plus
# staging; the control plane carries on if this job stops waiting.
count=$(tr ',' '\n' <<<"$COMPUTERS" | wc -l)
timeout=$((IDLE_WAIT_MINUTES + 60 + count * (RECONNECT_TIMEOUT_MINUTES + 5)))
# Under the job's 360 minutes, so the cleanup above runs.
if [ "$timeout" -gt 300 ]; then timeout=300; fi
"$bin" wait --environment dev --database-url-file "$secrets/database.url" \
  --upgrade-id "$upgrade_id" --timeout-minutes "$timeout" | tee -a "$GITHUB_STEP_SUMMARY"
