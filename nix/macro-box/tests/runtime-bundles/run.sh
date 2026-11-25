#!/usr/bin/env bash
set -euo pipefail
# Uses only local Docker and the agent image under test. The test guest
# has no network or enrollment and uses a synthetic chat/schedule spool.
test_dir=$(dirname "$(realpath "$0")")
repo=$(realpath "$test_dir/../../../..")
base=$(mktemp -d)
fixture="agent-runtime-test-${base##*.}"
bin=/run/current-system/sw/bin
image=${1:-macro-box-agent:latest}
cleanup() {
  if [[ $? != 0 ]]; then
    docker exec "$fixture" "$bin/journalctl" -u macro-agent -u macro-agent-runtime-update -u macro-agent-runtime-recover --no-pager -n 50 >&2 || true
  fi
  docker rm -f "$fixture" >/dev/null 2>&1 || true
  rm -rf "$base"
}
trap cleanup EXIT
mkdir -p "$base/docker"/{core,host}
chmod a+rx "$base/docker" "$base/docker/core" "$base/docker/host"
install -m 644 "$repo/packages/muppet/core/maintenance.ts" "$base/docker/core/"
install -m 644 "$repo/packages/muppet/host/maintenance.ts" "$base/docker/host/"
install -m 644 "$repo/packages/starter-agent/behavior/context/runtime-maintenance.ts" "$base/docker/"
install -m 644 "$repo/nix/macro-box/files/agent-runtime-update" "$base/docker/update"
install -m 644 "$repo/nix/macro-box/files/"{start-agent,agent-env-setting,agent-runtime-files.py} "$base/docker/"
install -m 644 "$test_dir"/{setup.sh,service.ts,land.sh} "$base/docker/"

docker run -d --name "$fixture" --privileged --cgroupns=private --tmpfs /run \
  --tmpfs /run/lock --network none \
  --mount "type=bind,source=$base/docker,target=/fixture,readonly" "$image" >/dev/null
guest() { docker exec "$fixture" "$bin/bash" -lc "$1"; }
wait_until() {
  for ((attempt=0; attempt<60; attempt++)); do
    if guest "$1"; then return; fi
    sleep 0.1
  done
  echo "not observed: $1" >&2
  return 1
}
version_a=$(printf 'a%.0s' {1..40})
version_b=$(printf 'b%.0s' {1..40})
version_c=$(printf 'c%.0s' {1..40})
version_d=$(printf 'd%.0s' {1..40})
work="$base/archive"
mkdir -p "$work/node_modules/@macro-inc/muppet/"{host,core}
cp "$base/docker/host/maintenance.ts" "$work/node_modules/@macro-inc/muppet/host/"
cp "$base/docker/core/maintenance.ts" "$work/node_modules/@macro-inc/muppet/core/"
echo '{"name":"agent-fixture","muppetApi":4,"dependencies":{"x":"1.0.0"}}' >"$work/template.json"
echo '{"apiLevel":4}' >"$work/node_modules/@macro-inc/muppet/package.json"
echo '{}' >"$work/bun.lock"
package() {
  tar --hard-dereference --sort=name --mtime=@0 --owner=0 --group=0 --numeric-owner -C "$work" -cf - bun.lock template.json node_modules |
    docker exec -i "$fixture" "$bin/zstd" -q -c >"$base/docker/archive"
  digest=$(sha256sum "$base/docker/archive" | cut -d' ' -f1)
}
submit() {
  local output transport=0
  output=$(printf '{"version":"%s","digest":"%s","url":"https://fixture.s3.amazonaws.com/agent-runtime-bundles/%s/runtime.tar.zst?X-Amz-Signature=fixture"}\n' "$1" "$2" "$1" |
    docker exec -i "$fixture" "$bin/bash" -lc '/opt/fixture/bin/update submit') || transport=$?
  printf '%s\n' "$output"
  if [[ $output =~ macro-agent-runtime-result=([0123])$ ]]; then
    return "${BASH_REMATCH[1]}"
  fi
  if (( transport == 0 )); then return 4; fi
  return "$transport"
}
assert_unchanged() {
  guest "test \"\$(systemctl show -P InvocationID macro-agent)\" = '$1'"
}
expect_exit() {
  local expected=$1 code=0
  shift
  "$@" || code=$?
  if [[ $code != "$expected" ]]; then
    echo "expected exit $expected, got $code" >&2
    return 1
  fi
}
wait_until 'test -x /run/current-system/sw/bin/systemctl && systemctl list-units --no-legend >/dev/null' >/dev/null 2>&1
docker exec "$fixture" "$bin/bash" /fixture/setup.sh
wait_until 'test -s /run/macro-agent-runtime/receipts/ready'
baseline=$(guest 'systemctl show -P InvocationID macro-agent')
boot=$(docker inspect --format '{{.State.StartedAt}}' "$fixture")
macrod=$(guest 'systemctl show -P InvocationID macrod')
[[ -n $macrod ]]
package
guest 'runuser -u macro -- mkdir -p /home/macro/agent/workspace/state; runuser -u macro -- touch /home/macro/agent/workspace/state/before; runuser -u macro -- git -C /home/macro/agent/workspace add state; runuser -u macro -- git -C /home/macro/agent/workspace -c user.name=Fixture -c user.email=fixture@example.com commit -qm memory'

echo 'Refuse untrusted revision values and nonregular receipts'
guest 'cp /home/macro/agent/state/last-good /opt/fixture/last-good
echo --not-a-revision > /home/macro/agent/state/last-good'
expect_exit 1 submit "$version_d" "$digest"
guest 'cat /opt/fixture/last-good > /home/macro/agent/state/last-good
mv /run/macro-agent-runtime/receipts/ready /opt/fixture/ready
mkfifo /run/macro-agent-runtime/receipts/ready'
expect_exit 1 submit "$version_d" "$digest"
assert_unchanged "$baseline"
guest 'rm /run/macro-agent-runtime/receipts/ready
mv /opt/fixture/ready /run/macro-agent-runtime/receipts/ready'

echo 'Inspection ignores checkout configuration for filters, hooks and fsmonitor'
guest 'config=/home/macro/agent/workspace/.git/config
git config --file "$config" core.fsmonitor /opt/fixture/bin/observe-config
git config --file "$config" core.hooksPath /opt/fixture/hooks
git config --file "$config" filter.fixture.clean /opt/fixture/bin/observe-config
git config --file "$config" filter.fixture.required true
printf "cli.ts filter=fixture\n" > /home/macro/agent/workspace/.gitattributes'
expect_exit 0 submit "$version_a" "$digest"
guest 'test ! -e /home/macro/.fixture/checkout-config-invoked'
guest "test \"\$(readlink /home/.macro-agent-runtime/current)\" = '$version_a'"
guest 'config=/home/macro/agent/workspace/.git/config
git config --file "$config" --unset core.fsmonitor
git config --file "$config" --unset core.hooksPath
git config --file "$config" --remove-section filter.fixture
rm /home/macro/agent/workspace/.gitattributes
/opt/fixture/bin/update restore-image'
wait_until 'jq -e ".runtime == \"image\"" /run/macro-agent-runtime/receipts/ready' >/dev/null
baseline=$(guest 'systemctl show -P InvocationID macro-agent')

echo 'Digest mismatch leaves the active invocation alone'
expect_exit 1 submit "$version_c" "$(printf 0%.0s {1..64})"
assert_unchanged "$baseline"

echo 'Incompatible behavior refuses the update before fencing'
echo '{"apiLevel":3}' >"$work/node_modules/@macro-inc/muppet/package.json"
package
expect_exit 1 submit "$version_d" "$digest"
assert_unchanged "$baseline"
echo '{"apiLevel":4}' >"$work/node_modules/@macro-inc/muppet/package.json"
package

echo 'Active work timeout releases the fence without a restart'
guest 'echo busy >> /home/macro/.fixture/events'
wait_until 'grep -q "delivering busy" /home/macro/.fixture/log'
expect_exit 1 submit "$version_a" "$digest"
assert_unchanged "$baseline"
guest 'test ! -e /run/macro-agent-runtime/fence && test ! -e /home/.macro-agent-runtime/current'

echo 'A land that commits behavior during the drain aborts the update'
before_land=$(guest 'runuser -u macro -- git -C /home/macro/agent/workspace rev-parse HEAD')
submit "$version_a" "$digest" &
land_update=$!
wait_until 'test -e /run/macro-agent-runtime/fence'
guest 'flock --nonblock /run/macro-agent-pause/lock true'
guest 'install -d -o macro -g macro /home/macro/agent/workspace/state/run/heartbeat'
guest 'runuser -u macro -- flock /home/macro/agent/workspace/state/run/heartbeat/git.lock /run/current-system/sw/bin/bash /fixture/land.sh
echo release > /home/macro/.fixture/release'
expect_exit 1 wait "$land_update"
assert_unchanged "$baseline"
guest 'test ! -e /run/macro-agent-runtime/fence && test ! -e /home/.macro-agent-runtime/current'
guest "runuser -u macro -- git -C /home/macro/agent/workspace restore --source=$before_land --staged --worktree cli.ts
runuser -u macro -- git -C /home/macro/agent/workspace commit -qm restore-fixture-behavior
rm -f /home/macro/.fixture/release
echo busy-again >> /home/macro/.fixture/events"
wait_until 'grep -q "delivering busy-again" /home/macro/.fixture/log'

echo 'A concurrent update is refused; queued input crosses the service restart'
submit "$version_a" "$digest" &
updating=$!
wait_until 'test -e /run/macro-agent-runtime/fence'
# An admitted land must be able to send its restart through the pause
# helper while the updater waits for active work.
guest 'flock --nonblock /run/macro-agent-pause/lock true'
expect_exit 1 submit "$version_b" "$digest"
guest 'echo queued-dm >> /home/macro/.fixture/events; echo queued-event >> /home/macro/.fixture/events; echo queued-schedule >> /home/macro/.fixture/events; echo release > /home/macro/.fixture/release'
wait "$updating"
wait_until 'grep -q "^queued-schedule$" /home/macro/.fixture/done'
current=$(guest 'systemctl show -P InvocationID macro-agent')
[[ $current != "$baseline" ]]
guest "test \"\$(readlink /home/.macro-agent-runtime/current)\" = '$version_a'"
guest 'grep -E "^delivering queued-(dm|event|schedule) on a{40}:" /home/macro/.fixture/log'
submit "$version_a" "$digest"
expect_exit 1 submit "$version_a" "$(printf 0%.0s {1..64})"
assert_unchanged "$current"

echo 'Failed readiness restores and verifies the previous runtime'
expect_exit 2 submit "$version_b" "$digest"
guest "test \"\$(readlink /home/.macro-agent-runtime/current)\" = '$version_a'"
after_rollback=$(guest 'systemctl show -P InvocationID macro-agent')
[[ $after_rollback != "$current" ]]

echo 'An interrupted apply produces no terminal outcome; a killed recovery releases the fence'
guest 'touch /home/macro/.fixture/suppress-ready'
submit "$version_b" "$digest" >"$base/interrupted.log" 2>&1 &
crashing=$!
wait_until "test \"\$(readlink /home/.macro-agent-runtime/current 2>/dev/null || true)\" = '$version_b'"
guest 'systemctl kill --signal=KILL macro-agent-runtime-update.service'
if wait "$crashing"; then
  echo 'expected interrupted update to fail' >&2
  exit 1
fi
cat "$base/interrupted.log"
if grep -q '^macro-agent-runtime-result=' "$base/interrupted.log"; then exit 1; fi
wait_until 'test "$(systemctl show -P MainPID macro-agent-runtime-recover)" -gt 1'
guest 'systemctl kill --kill-whom=main --signal=KILL macro-agent-runtime-recover.service'
wait_until 'test ! -e /run/macro-agent-runtime/fence'
guest 'rm /home/macro/.fixture/suppress-ready'
wait_until "test ! -e /home/.macro-agent-runtime/transaction.json && test \"\$(readlink /home/.macro-agent-runtime/current)\" = '$version_a'"
wait_until '/opt/fixture/bin/update status'
guest 'journalctl -u macro-agent-runtime-recover -n 20 --no-pager -o cat'

wait_until 'test "$(systemctl show -P LoadState macro-agent-runtime-update)" = not-found'
echo 'An active baseline with no current readiness receipt is refused'
guest 'touch /home/macro/.fixture/old-behavior; systemctl restart macro-agent'
wait_until 'systemctl is-active --quiet macro-agent'
unready=$(guest 'systemctl show -P InvocationID macro-agent')
expect_exit 1 submit "$version_c" "$digest"
assert_unchanged "$unready"

echo 'An image change clears the old bundle selection and cache'
guest 'rm -f /home/macro/.fixture/old-behavior
ln -sfn /opt/fixture/next-image /opt/fixture/system
/opt/fixture/bin/update boot
test ! -e /home/.macro-agent-runtime/current
test -z "$(find /home/.macro-agent-runtime -mindepth 1 -maxdepth 1 -type d -print)"'

echo 'The emergency operator command returns to the image runtime'
guest 'rm -f /home/macro/.fixture/old-behavior; /opt/fixture/bin/update restore-image'
wait_until 'jq -e ".runtime == \"image\"" /run/macro-agent-runtime/receipts/ready'
[[ $(docker inspect --format '{{.State.StartedAt}}' "$fixture") == "$boot" ]]
guest "test \"\$(systemctl show -P InvocationID macrod)\" = '$macrod'"
guest 'cat /home/macro/.fixture/log'
