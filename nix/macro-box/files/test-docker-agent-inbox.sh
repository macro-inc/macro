#!/usr/bin/env bash
# The agent environment on Docker computers, end to end with locally built
# images: an agent image's macrod stages an ApplyAgent from a stand-in Macro
# in /run/macro-agent-inbox, macro-agent-apply installs it and the agent
# starts; a person image's macrod refuses it. Containers run as DockerFleet
# creates them (crates/hosted_runtimes/src/outbound/docker_fleet.rs); the
# stand-in (test-fake-macro.py) runs inside each one, on its loopback.
#
#   nix build .#macro-box-agent-docker -o agent-image
#   nix build .#macro-box-docker -o person-image
#   nix shell nixpkgs#skopeo -c nix/macro-box/files/test-docker-agent-inbox.sh agent-image person-image
#
# The images are loaded under a throwaway tag, never `:latest`, so a local
# stack's images stay as they are. KEEP=1 leaves the containers running.
set -euo pipefail

agent_archive=$1
person_archive=$2
here=$(cd "$(dirname "$0")" && pwd)
run=inbox-test-$$
work=$(mktemp -d)
port=41009

cleanup() {
  if [ -n "${KEEP:-}" ]; then
    echo "kept $run-agent and $run-person" >&2
    return
  fi
  docker rm --force "$run-agent" "$run-person" > /dev/null 2>&1 || true
  docker rmi "macro-box-agent-test:$run" "macro-box-test:$run" > /dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT

fail() {
  echo "FAIL: $*" >&2
  for container in "$run-agent" "$run-person"; do
    echo "--- $container" >&2
    docker exec "$container" journalctl --no-pager -n 40 -u macrod.service -u macro-agent-apply.service -u macro-agent.service >&2 || true
    docker exec "$container" cat /tmp/fake-macro.log >&2 || true
  done
  exit 1
}

# Retry a command for up to two minutes.
eventually() {
  for _ in $(seq 240); do
    if "$@" > /dev/null 2>&1; then
      return 0
    fi
    sleep 0.5
  done
  return 1
}

echo '{"default": [{"type": "insecureAcceptAnything"}]}' > "$work/policy.json"
skopeo --policy "$work/policy.json" copy --quiet "docker-archive:$agent_archive" "docker-daemon:macro-box-agent-test:$run"
skopeo --policy "$work/policy.json" copy --quiet "docker-archive:$person_archive" "docker-daemon:macro-box-test:$run"

echo '{"MACRO_REPO_URL": "http://127.0.0.1:9/repo.git", "MACRO_REPO_TOKEN": "test-token", "MACRO_AGENT_USER_ID": "macro|ada@example.com", "MACRO_AGENT_NAME": "Applied"}' > "$work/agent-environment.json"

start() {
  local role=$1 image=$2 container=$run-$1
  mkdir -p "$work/$role"
  cat > "$work/$role/enrollment.json" << EOF
{
  "generation": 1,
  "computer_id": "00000000-0000-0000-0000-00000000000c",
  "pairing_id": "00000000-0000-0000-0000-00000000000a",
  "device_secret": "mhds_test",
  "name": "Docker $role",
  "role": "$role",
  "deployment": {
    "agent_harness_url": "http://127.0.0.1:$port/agent-harness/",
    "document_storage_url": "http://127.0.0.1:$port/dss",
    "app_url": "http://127.0.0.1:$port",
    "egress_url": "http://127.0.0.1:$port"
  }
}
EOF
  docker run --detach --name "$container" \
    --privileged --cgroupns=private --tmpfs /run --tmpfs /run/lock \
    --mount "type=bind,source=$work/$role,target=/run/macro,readonly" \
    "$image" > /dev/null
  docker cp --quiet "$here/test-fake-macro.py" "$container:/tmp/fake-macro.py"
  docker cp --quiet "$work/agent-environment.json" "$container:/tmp/agent-environment.json"
  # The enrollment's claim retries until the stand-in answers.
  eventually docker exec "$container" test -x /run/current-system/sw/bin/python3 \
    || fail "$container never booted its system"
  docker exec --detach "$container" sh -c \
    "/run/current-system/sw/bin/python3 /tmp/fake-macro.py $port /tmp/agent-environment.json 2> /tmp/fake-macro.log"
}
start agent "macro-box-agent-test:$run"
start person "macro-box-test:$run"

agent() { docker exec "$run-agent" "$@"; }
person() { docker exec "$run-person" "$@"; }
journal() { docker exec "$1" journalctl -u "$2" -o cat | grep -F "$3"; }

echo "an agent's Docker computer installs the ApplyAgent environment and starts the agent"
eventually agent grep -F 'sent applyAgent' /tmp/fake-macro.log || fail "the agent's macrod never connected"
eventually agent grep -Fx 'MACRO_AGENT_NAME="Applied"' /var/lib/macrod/agent.env \
  || fail "the agent's computer never installed agent.env"
[ "$(agent stat -c '%U %a' /var/lib/macrod/agent.env)" = "macro 600" ] || fail "agent.env is not macro's, 0600"
[ "$(agent stat -c '%U %G %a' /run/macro-agent-inbox)" = "macro macro 700" ] || fail "the inbox is not macro's, 0700"
agent test ! -s /run/macro-agent-inbox/agent.env || fail "the inbox was not emptied"
eventually journal "$run-agent" macro-agent.service 'Started Macro agent teammate' \
  || fail "macro-agent.service never started"

echo "a person's Docker computer refuses it"
eventually person grep -F 'sent applyAgent' /tmp/fake-macro.log || fail "the person's macrod never connected"
eventually journal "$run-person" macrod.service '/run/macro-agent-inbox is absent: this computer runs no agent' \
  || fail "the person's macrod did not refuse ApplyAgent"
person test ! -e /run/macro-agent-inbox || fail "a person's computer has an inbox"
person test ! -e /var/lib/macrod/agent.env || fail "a person's computer got agent.env"

echo "ok"
