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
cat >"$root/bin/bun" <<EOF
#!/usr/bin/env bash
echo "\$*" >>"$root/bun.ran"
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

exit "$failed"
