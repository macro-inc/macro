#!/usr/bin/env bash
# Tests start-agent's boot (dependency lock, rollback) and agent-stopped's
# failure count against real git repositories in a temporary directory. The
# scripts are assembled the way `_agent.nix` assembles them: variables, then
# agent-env-setting, then the script. `bun` is a fake that records its run.
# usage: test-start-agent.sh   (needs git, bash, coreutils, diffutils, sed)
set -euo pipefail
files=$(cd "$(dirname "$0")" && pwd)
root=$(mktemp -d)
trap 'rm -rf "$root"' EXIT
failed=0

export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t
export GIT_CONFIG_NOSYSTEM=1 HOME=$root/home
mkdir -p "$HOME" "$root/bin"
# The repository URL must be HTTP(S); git reads it from a local bare repo instead.
git config --global url."file://$root/remote.git".insteadOf https://git.test/agent.git
git config --global init.defaultBranch main
# The build sandbox has no /usr/bin/env: name this bash by its path. The
# runtime's run is recorded; \`bun -e\` (start-agent reads package.json with
# it) goes to the real bun.
real_bun=$(command -v bun)
cat >"$root/bin/bun" <<EOF
#!$(command -v bash)
[[ \$1 == -e ]] && exec "$real_bun" "\$@"
echo "\$*" >>"$root/bun.ran"
echo "\${MACRO_SETUP_TRACEPARENT-unset}" >"$root/bun.trace"
echo "\${OTEL_EXPORTER_OTLP_ENDPOINT-unset}" >"$root/bun.otlp"
echo "\${MACRO_LAUNCH_TIMINGS-unset}" >"$root/bun.launch"
echo "\${OTEL_EXPORTER_OTLP_HEADERS-unset}" >"$root/bun.headers"
echo "\${OTEL_DEPLOYMENT_ENVIRONMENT-unset}" >"$root/bun.deployment"
EOF
chmod +x "$root/bin/bun"
export PATH=$root/bin:$PATH

check() { # check <name> <command...>
  local name=$1
  shift
  if "$@"; then echo "ok   $name"; else echo "FAIL $name"; failed=1; fi
}

# A fresh case: the agent's repo on the remote (template commit), the image's runtime, state files.
fresh() {
  rm -rf "$root/case" "$root/remote.git" "$root/bun.ran"
  mkdir -p "$root/case/state" "$root/case/runtime/node_modules"
  git init -q --bare "$root/remote.git"
  local seed=$root/case/seed
  git init -q "$seed"
  echo '{"name":"agent","dependencies":{"zod":"4.4.3"}}' >"$seed/package.json"
  echo 'lock v1' >"$seed/bun.lock"
  echo 'export {}' >"$seed/cli.ts"
  git -C "$seed" add -A
  git -C "$seed" commit -qm 'template'
  git -C "$seed" push -q "$root/remote.git" HEAD:main
  echo 'lock v1' >"$root/case/runtime/bun.lock"
  printf 'MACRO_REPO_URL=https://git.test/agent.git\nMACRO_REPO_TOKEN=t\nMACRO_AGENT_USER_ID=macro|agent@example.com\nMACRO_AGENT_NAME=Fox\n' >"$root/case/agent.env"
}

script() { # script <name>: the assembled script, as `_agent.nix` builds it
  local case=$root/case
  {
    echo "workspace=$case/workspace"
    echo "last_good=$case/state/last-good"
    echo "failures=$case/state/failures"
    echo "boot_head=$case/state/boot-head"
    echo "max_failed_boots=3"
    echo "runtime=$case/runtime"
    echo "helper=true"
    echo "helper_credentials=$case/agent.env"
    echo "setup_traceparent=$case/inbox/setup-traceparent"
    echo "setup_traceparent_used=$case/state/setup-traceparent"
    [[ $1 == start-agent ]] && cat "$files/agent-env-setting"
    cat "$files/$1"
  } >"$case/$1"
  echo "$case/$1"
}

start() { MUPPET_CREDENTIALS_FILE=$root/case/agent.env bash "$(script start-agent)" run 2>"$root/case/stderr"; }
ws() { git -C "$root/case/workspace" "$@"; }
ran() { [[ -s $root/bun.ran ]]; }

# --- B7: a lock that differs from the image's ---------------------------------
fresh
start
echo 'lock v2' >"$root/case/runtime/bun.lock" # an image update changed the template's lock
: >"$root/bun.ran"
check 'B7 an unchanged agent boots on the image lock' start
check 'B7 the workspace now has the image lock' cmp -s "$root/case/workspace/bun.lock" "$root/case/runtime/bun.lock"
check 'B7 the adoption is a commit, so the runtime pushes it' bash -c "git -C '$root/case/workspace' log -1 --format=%s | grep -q 'adopt the image'"
check 'B7 the runtime ran' ran

fresh
start
ws checkout -q main
echo '{"name":"agent","dependencies":{"zod":"4.4.3","left-pad":"1.3.0"}}' >"$root/case/workspace/package.json"
ws commit -qam 'self-edit: add left-pad'
echo 'lock v2' >"$root/case/runtime/bun.lock"
: >"$root/bun.ran"
check 'B7 an agent that changed its dependencies does not boot' bash -c "! MUPPET_CREDENTIALS_FILE='$root/case/agent.env' bash '$root/case/start-agent' run 2>/dev/null"
check 'B7 and the runtime did not run' bash -c "[[ ! -s '$root/bun.ran' ]]"
check 'B7 that failed boot is counted against the edit' bash -c "[[ \$(cat '$root/case/state/boot-head') == \$(git -C '$root/case/workspace' rev-parse HEAD) ]]"
# After max failed boots it rolls back to last-good, whose package.json is the
# template's, and boots on the image's lock.
good=$(ws rev-parse HEAD~1)
echo "$good" >"$root/case/state/last-good"
echo 3 >"$root/case/state/failures"
: >"$root/bun.ran"
check 'B7 the rolled-back agent boots on the image lock' start
check 'B7 with the image lock' cmp -s "$root/case/workspace/bun.lock" "$root/case/runtime/bun.lock"

fresh
start
ws checkout -q main
echo '{"name":"agent","scripts":{"check":"bun test"},"dependencies":{"zod":"4.4.3"}}' >"$root/case/workspace/package.json"
ws commit -qam 'self-edit: a check script'
echo 'lock v2' >"$root/case/runtime/bun.lock"
: >"$root/bun.ran"
check 'B7a a package.json changed only outside its dependencies boots on the image lock' start
check 'B7a with the image lock' cmp -s "$root/case/workspace/bun.lock" "$root/case/runtime/bun.lock"

fresh
start
ws checkout -q main
echo '{"name":"agent","dependencies":{"zod":"4.4.3"},"devDependencies":{"typescript":"5.9.3"}}' >"$root/case/workspace/package.json"
ws commit -qam 'self-edit: a dev dependency'
echo 'lock v2' >"$root/case/runtime/bun.lock"
check 'B7a a changed devDependencies still fails the boot' bash -c "! MUPPET_CREDENTIALS_FILE='$root/case/agent.env' bash '$root/case/start-agent' run 2>/dev/null"

# --- B8: a rollback survives the runtime's next pull --rebase -----------------
fresh
start
good=$(ws rev-parse HEAD)
echo "$good" >"$root/case/state/last-good"
echo 'broken' >"$root/case/workspace/cli.ts"
ws commit -qam 'self-edit: break it'
ws push -q origin HEAD:main
broken=$(ws rev-parse HEAD)
echo 3 >"$root/case/state/failures"
start
check 'B8 the boot runs last-good code' bash -c "[[ \$(git -C '$root/case/workspace' rev-parse 'HEAD^{tree}') == \$(git -C '$root/case/workspace' rev-parse '$good^{tree}') ]]"
check 'B8 the rollback sits on top of the broken head' ws merge-base --is-ancestor "$broken" HEAD
ws pull -q --rebase origin main
check 'B8 a pull --rebase keeps the rollback' bash -c "[[ \$(git -C '$root/case/workspace' rev-parse 'HEAD^{tree}') == \$(git -C '$root/case/workspace' rev-parse '$good^{tree}') ]]"
check 'B8 the failure count restarts' bash -c "[[ \$(cat '$root/case/state/failures') == 0 ]]"
check 'B8 boot-head names the rollback' bash -c "[[ \$(cat '$root/case/state/boot-head') == \$(git -C '$root/case/workspace' rev-parse HEAD) ]]"
check 'B8 the rollback is last-good: the same tree' bash -c "[[ \$(cat '$root/case/state/last-good') == \$(git -C '$root/case/workspace' rev-parse HEAD) ]]"
# A boot of the rolled-back code that dies before the runtime marks it healthy
# (Macro unreachable, say) is not the code's fault: it must not count toward
# another rollback from the rollback itself.
EXIT_CODE=exited EXIT_STATUS=1 SERVICE_RESULT=exit-code bash "$(script agent-stopped)"
check 'B8 an early death of the rolled-back code does not count' bash -c "[[ \$(cat '$root/case/state/failures') == 0 ]]"
: >"$root/bun.ran"
check 'B8 the next boot does not see its own rollback as a dependency edit' start

# --- B9: exit 78 after a self-edit counts as a failed boot --------------------
stopped() { EXIT_CODE=exited EXIT_STATUS=$1 SERVICE_RESULT=exit-code bash "$(script agent-stopped)"; }
fresh
echo good >"$root/case/state/last-good"
echo bad >"$root/case/state/boot-head"
echo 0 >"$root/case/state/failures"
stopped 78
check 'B9 a configuration error on a new head counts' bash -c "[[ \$(cat '$root/case/state/failures') == 1 ]]"
echo good >"$root/case/state/boot-head"
stopped 78
check 'B9 a configuration error on last-good does not count' bash -c "[[ \$(cat '$root/case/state/failures') == 0 ]]"
echo bad >"$root/case/state/boot-head"
echo 0 >"$root/case/state/failures"
stopped 75
stopped 0
check 'B9 a restart after a land and a clean stop never count' bash -c "[[ \$(cat '$root/case/state/failures') == 0 ]]"
stopped 1
check 'B9 a crash on a new head counts' bash -c "[[ \$(cat '$root/case/state/failures') == 1 ]]"

# --- B10: the agent's code needs a newer muppet than the image has ------------
# The template declares the muppet API it needs (package.json `muppetApi`);
# the image's muppet declares the level it has (its package.json `apiLevel`).
image_muppet() { # image_muppet <level>: the image's muppet package
  mkdir -p "$root/case/runtime/node_modules/@macro-inc/muppet"
  echo "{\"name\":\"@macro-inc/muppet\",\"apiLevel\":$1}" >"$root/case/runtime/node_modules/@macro-inc/muppet/package.json"
}
needs_muppet() { # needs_muppet <level>: the agent's code, committed
  ws checkout -q main
  echo "{\"name\":\"agent\",\"muppetApi\":$1,\"dependencies\":{\"zod\":\"4.4.3\"}}" >"$root/case/workspace/package.json"
  ws commit -qam "needs muppet API $1"
}
fresh
start
needs_muppet 2
image_muppet 1
: >"$root/bun.ran"
MUPPET_CREDENTIALS_FILE=$root/case/agent.env bash "$root/case/start-agent" run 2>"$root/case/stderr" && code=0 || code=$?
check 'B10 a new agent whose code needs a newer muppet exits 79, which is not restarted' bash -c "[[ $code == 79 ]]"
check 'B10 and says the agent needs a newer image' grep -q 'needs a newer image: its code needs muppet API 2, the image has 1' "$root/case/stderr"
check 'B10 and the runtime did not run' bash -c "[[ ! -s '$root/bun.ran' ]]"
check 'B10 that boot is counted against the head that needs it' bash -c "[[ \$(cat '$root/case/state/boot-head') == \$(git -C '$root/case/workspace' rev-parse HEAD) ]]"

fresh
start
needs_muppet 2
image_muppet 2
: >"$root/bun.ran"
check 'B10 code that needs the level the image has boots' start
check 'B10 and the runtime ran' ran

fresh
start
needs_muppet 1
image_muppet 3
: >"$root/bun.ran"
check 'B10 code that needs a lower level runs on a newer image: the API only grows' start

fresh
image_muppet 1
: >"$root/bun.ran"
check 'B10 a template that declares no need boots on any image' start

fresh
start
needs_muppet 1
rm -rf "$root/case/runtime/node_modules/@macro-inc"
: >"$root/bun.ran"
MUPPET_CREDENTIALS_FILE=$root/case/agent.env bash "$root/case/start-agent" run 2>"$root/case/stderr" && code=0 || code=$?
check 'B10 an image whose muppet declares no level has level 0' bash -c "[[ $code == 79 ]] && grep -q 'the image has 0' '$root/case/stderr'"

fresh
start
needs_muppet '"two"'
: >"$root/bun.ran"
MUPPET_CREDENTIALS_FILE=$root/case/agent.env bash "$root/case/start-agent" run 2>"$root/case/stderr" && code=0 || code=$?
check 'B10 a need that is not a whole number exits 78 and says so' bash -c "[[ $code == 78 ]] && grep -q 'muppetApi must be a whole number' '$root/case/stderr'"

fresh
start
needs_muppet 9223372036854775808
image_muppet 1
: >"$root/bun.ran"
MUPPET_CREDENTIALS_FILE=$root/case/agent.env bash "$root/case/start-agent" run 2>"$root/case/stderr" && code=0 || code=$?
check 'B10 a need too large to compare exits 78 and says so' bash -c "[[ $code == 78 ]] && grep -q 'muppetApi must be a whole number' '$root/case/stderr'"
check 'B10 and the runtime did not run' bash -c "[[ ! -s '$root/bun.ran' ]]"

# A land whose code needs a newer muppet, with last-good to go back to: 78,
# counted, so it rolls back.
fresh
start
echo "$(ws rev-parse HEAD)" >"$root/case/state/last-good"
needs_muppet 2
image_muppet 1
: >"$root/bun.ran"
MUPPET_CREDENTIALS_FILE=$root/case/agent.env bash "$root/case/start-agent" run 2>"$root/case/stderr" && code=0 || code=$?
check 'B10 a land that needs a newer muppet exits 78, so it rolls back' bash -c "[[ $code == 78 ]]"
echo 0 >"$root/case/state/failures"
stopped 78
check 'B10 and that boot counts toward the rollback' bash -c "[[ \$(cat '$root/case/state/failures') == 1 ]]"

# After an image rollback last-good needs more than the image too: rolling
# back can't help, so it stops (79) instead of looping through rollbacks.
fresh
start
needs_muppet 2
echo "$(ws rev-parse HEAD)" >"$root/case/state/last-good"
echo 'lock v2' >"$root/case/runtime/bun.lock" # the older image adopts its own lock, a new head
image_muppet 1
: >"$root/bun.ran"
MUPPET_CREDENTIALS_FILE=$root/case/agent.env bash "$root/case/start-agent" run 2>"$root/case/stderr" && code=0 || code=$?
check 'B10 a land on a last-good that also needs more stops with 79, not a rollback loop' bash -c "[[ $code == 79 ]]"

# An image whose muppet package.json has no apiLevel, or a garbled one.
fresh
start
needs_muppet 1
mkdir -p "$root/case/runtime/node_modules/@macro-inc/muppet"
echo '{"name":"@macro-inc/muppet"}' >"$root/case/runtime/node_modules/@macro-inc/muppet/package.json"
MUPPET_CREDENTIALS_FILE=$root/case/agent.env bash "$root/case/start-agent" run 2>"$root/case/stderr" && code=0 || code=$?
check 'B10 a muppet package.json without apiLevel has level 0' bash -c "[[ $code == 79 ]] && grep -q 'the image has 0' '$root/case/stderr'"
image_muppet '"one"'
MUPPET_CREDENTIALS_FILE=$root/case/agent.env bash "$root/case/start-agent" run 2>"$root/case/stderr" && code=0 || code=$?
check "B10 a garbled image apiLevel exits 78 and says so" bash -c "[[ $code == 78 ]] && grep -q 'apiLevel must be a whole number' '$root/case/stderr'"

# --- B11: what agent-stopped counts around a mismatch and a healthy boot ------
fresh
echo good >"$root/case/state/last-good"
echo bad >"$root/case/state/boot-head"
echo 0 >"$root/case/state/failures"
stopped 79
check 'B11 a boot that needs a newer image never counts' bash -c "[[ \$(cat '$root/case/state/failures') == 0 ]]"
echo 2 >"$root/case/state/failures"
echo good >"$root/case/state/boot-head"
stopped 0
check 'B11 a clean stop of last-good code starts the count again' bash -c "[[ \$(cat '$root/case/state/failures') == 0 ]]"
echo 2 >"$root/case/state/failures"
stopped 75
check 'B11 so does a restart of last-good code after a land' bash -c "[[ \$(cat '$root/case/state/failures') == 0 ]]"

# --- B12: the setup trace reaches the runtime's first start only -----------
trace=00-11111111111111111111111111111111-2222222222222222-01
fresh
mkdir -p "$root/case/inbox"
echo -n "$trace" >"$root/case/inbox/setup-traceparent"
start
check 'B12 the first start runs under the setup trace macrod staged' bash -c "[[ \$(cat '$root/bun.trace') == '$trace' ]]"
start
check 'B12 a restart in the same boot does not join it again' bash -c "[[ \$(cat '$root/bun.trace') == unset ]]"
echo -n 'not-a-trace' >"$root/case/inbox/setup-traceparent"
start
check 'B12 a malformed one is ignored' bash -c "[[ \$(cat '$root/bun.trace') == unset ]]"
fresh
start
check 'B12 without one the runtime gets none' bash -c "[[ \$(cat '$root/bun.trace') == unset ]]"
fresh
echo 'OTEL_EXPORTER_OTLP_ENDPOINT="https://intake.test/i/otlp"' >>"$root/case/agent.env"
start
check 'B12 the runtime exports where agent.env says' bash -c "[[ \$(cat '$root/bun.otlp') == https://intake.test/i/otlp ]]"
check 'B12 without a computer id it sends no header' bash -c "[[ \$(cat '$root/bun.headers') == unset ]]"
echo 'MACRO_COMPUTER_ID=01900000-0000-7000-8000-000000000001' >>"$root/case/agent.env"
start
check 'B12 and names its computer to the intake' bash -c "[[ \$(cat '$root/bun.headers') == x-macro-computer-id=01900000-0000-7000-8000-000000000001 ]]"
check 'B12 without a deployment its spans are untagged' bash -c "[[ \$(cat '$root/bun.deployment') == unset ]]"
echo 'OTEL_DEPLOYMENT_ENVIRONMENT="dev"' >>"$root/case/agent.env"
start
check 'B12 and tags them with the deployment agent.env names' bash -c "[[ \$(cat '$root/bun.deployment') == dev ]]"
fresh
echo 'OTEL_DEPLOYMENT_ENVIRONMENT="dev"' >>"$root/case/agent.env"
start
check 'B12 without an intake the deployment is not passed' bash -c "[[ \$(cat '$root/bun.deployment') == unset ]]"
fresh
echo 'OTEL_EXPORTER_OTLP_ENDPOINT="https://intake.test/i/otlp"' >>"$root/case/agent.env"
echo 'OTEL_DEPLOYMENT_ENVIRONMENT="dev; rm -rf /"' >>"$root/case/agent.env"
start
check 'B12 a malformed deployment is ignored' bash -c "[[ \$(cat '$root/bun.deployment') == unset ]]"

# --- B13: the runtime gets the times of start-agent's steps -------------------
step='[0-9]{16}:[0-9]{16}'
first="^started:[0-9]{16},settings:$step,clone:$step,configure:$step,rollback:$step,packages:$step,compatibility:$step,exec:[0-9]{16}\$"
again="^started:[0-9]{16},settings:$step,configure:$step,rollback:$step,packages:$step,compatibility:$step,exec:[0-9]{16}\$"
fresh
start
check 'B13 a first start times each step, the clone included' bash -c "[[ \$(cat '$root/bun.launch') =~ $first ]]"
start
check 'B13 a restart has no clone step' bash -c "[[ \$(cat '$root/bun.launch') =~ $again ]]"

exit "$failed"
