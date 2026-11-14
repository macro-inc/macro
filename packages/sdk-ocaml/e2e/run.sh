#!/usr/bin/env bash
# End-to-end check of permissioned OCaml SDK programs:
#   1. the duplicate-check program (test/duplicate_check.ml) is allowed and runs through
#      the proxy to a fake upstream service, which sees both of its requests;
#   2. a program naming a blocked operation (rules block @destroy) is refused before it runs;
#   3. a call the runner's permission check let through is rejected by the proxy (403
#      blocked), because the proxy asks a stricter permission endpoint on every call;
#   4. a run token used directly for an operation the policy allows but the analysis did
#      not list is refused (403 not_analyzed), and the execution token cannot call at all.
#
# Usage: packages/sdk-ocaml/e2e/run.sh
# Env:   MACRO_SDK_PACKAGE (default macro_sdk), MACRO_SDK_OPERATIONS (default the installed
#        operations.json), PROXY_DIR (default packages/sdk-ocaml/proxy)
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(dirname "$here")"

if ! command -v dune >/dev/null || ! command -v bun >/dev/null; then
  exec nix-shell "$root/shell.nix" --run "$(printf '%q ' "$0" "$@")"
fi

proxy_dir="${PROXY_DIR:-$root/proxy}"
export MACRO_SDK_PACKAGE="${MACRO_SDK_PACKAGE:-macro_sdk}"
token="e2e-token-$$-$RANDOM"
work="$(mktemp -d)"

pids=()

cleanup() {
  for pid in "${pids[@]}"; do kill "$pid" 2>/dev/null || true; done
  rm -rf "$work"
}
trap cleanup EXIT

repo="$(cd "$root/../.." && pwd)"
[[ -d "$repo/node_modules" ]] || (cd "$repo" && bun install --frozen-lockfile)
# The client (lib/macro*.ml, operations.json) is generated, not committed;
# regenerate it every time so a stale checkout can't test an old one.
(cd "$root" && bun generator/generate.ts >/dev/null)

(cd "$root" && dune build @install)
export OCAMLPATH="$root/_build/install/default/lib${OCAMLPATH:+:$OCAMLPATH}"
export PATH="$root/_build/install/default/bin:$PATH"
# The operation table the analyzer, the permission endpoints and the proxy
# share: the one installed beside the SDK (D1 entries plus "ocaml").
operations="${MACRO_SDK_OPERATIONS:-$(ocamlfind query "$MACRO_SDK_PACKAGE")/operations.json}"

start() {
  local name="$1"
  shift
  (cd "$proxy_dir" && exec bun run "$@") >"$work/$name.log" 2>&1 &
  pids+=("$!")
}

# Each server binds port 0 (the kernel picks a free one, so nothing can take
# it between picking and binding) and logs a "<name>.listening" line with the
# URL it bound; wait for that line and print the URL.
listening_url() {
  local log="$work/$1.log" pid="$2" url
  for _ in $(seq 300); do
    url=$(grep -o '\.listening".*"url":"[^"]*"' "$log" | head -1 | sed -E 's/.*"url":"([^"]*)"/\1/')
    if [[ -n "$url" ]]; then
      echo "${url%/}"
      return 0
    fi
    kill -0 "$pid" 2>/dev/null || break
    sleep 0.1
  done
  echo "$1 did not start:" >&2
  cat "$log" >&2
  exit 1
}

start strict src/permissions.ts --rules "$here/rules-strict.json" --operations "$operations" --port 0
start permissive src/permissions.ts --rules "$here/rules-permissive.json" --operations "$operations" --port 0
start upstream src/fake-upstream.ts --responses "$here/upstream.json" --port 0
strict_url=$(listening_url strict "${pids[0]}")
permissive_url=$(listening_url permissive "${pids[1]}")
upstream_url=$(listening_url upstream "${pids[2]}")
# The execution token and the credential go through the environment, not
# argv (visible in ps). The credential is a placeholder the fake upstream
# never checks; programs never see it.
MACRO_SDK_EXECUTION_TOKEN="$token" MACRO_API_KEY="e2e-credential" start proxy src/proxy.ts \
  --operations "$operations" --permissions-url "$strict_url" \
  --upstream "storage=$upstream_url" --port 0
proxy_url=$(listening_url proxy "${pids[3]}")

export MACRO_SDK_PROXY_URL="$proxy_url"
export MACRO_SDK_EXECUTION_TOKEN="$token"  # the runner's; programs get a run token
failures=0

# check <name> <expected exit> <text stdout must contain> <runner args...>
check() {
  local name="$1" expected_exit="$2" expected_text="$3"
  shift 3
  local exit_code=0
  "$@" >"$work/out" 2>"$work/err" || exit_code=$?
  echo "--- $name"
  sed 's/^/    stderr: /' "$work/err"
  sed 's/^/    stdout: /' "$work/out"
  if [[ "$exit_code" == "$expected_exit" ]] && grep -qF -- "$expected_text" "$work/out"; then
    echo "    PASS (exit $exit_code)"
  else
    echo "    FAIL: expected exit $expected_exit and stdout containing $expected_text, got exit $exit_code"
    failures=$((failures + 1))
  fi
}

calls() { grep -c '"sdk_call"' "$work/proxy.log" || true; }
upstream_requests() { grep -c '"upstream.request"' "$work/upstream.log" || true; }

check "1. duplicate check is allowed and runs through the proxy" 0 '"created":{"id":"task-1"' \
  env MACRO_SDK_PERMISSIONS_URL="$strict_url" macro-sdk-run "$root/test/duplicate_check.ml"
# The fake upstream logs asynchronously; give its log a moment.
for _ in $(seq 20); do [[ "$(upstream_requests)" -ge 2 ]] && break; sleep 0.1; done
if [[ "$(upstream_requests)" != 2 ]] || ! grep -q '/documents/similarity_search' "$work/upstream.log" \
  || ! grep -q '/documents/create_task' "$work/upstream.log"; then
  echo "    FAIL: the fake upstream did not get the search and the create"
  cat "$work/upstream.log"
  failures=$((failures + 1))
fi

calls_before=$(calls)
check "2. a program naming a blocked operation is refused before it runs" 3 '"methods":["storage.delete_document"]' \
  env MACRO_SDK_PERMISSIONS_URL="$strict_url" macro-sdk-run "$here/programs/delete_document.ml"
if [[ "$(calls)" != "$calls_before" ]]; then
  echo "    FAIL: the proxy saw a call from a refused program"
  failures=$((failures + 1))
fi

upstream_before=$(upstream_requests)
check "3a. the proxy blocks an operation at call time, even after the runner allowed it" 4 '"code":"blocked"' \
  env MACRO_SDK_PERMISSIONS_URL="$permissive_url" macro-sdk-run "$here/programs/delete_document.ml"
if [[ "$(upstream_requests)" != "$upstream_before" ]]; then
  echo "    FAIL: a blocked call reached the upstream"
  failures=$((failures + 1))
fi

# register <operations JSON array>: a run token, as the runner gets one.
register() {
  curl --silent --fail -X POST "$MACRO_SDK_PROXY_URL/v1/executions" \
    -H 'content-type: application/json' -H "authorization: Bearer $token" \
    -d "{\"operations\":$1}" | sed -E 's/.*"token":"([^"]+)".*/\1/'
}

# expect_call <name> <bearer> <method> <path> <body or ""> <expected status> <expected text>
expect_call() {
  local name="$1" bearer="$2" method="$3" path="$4" body="$5" expected_status="$6" expected_text="$7" status
  local args=(--silent --output "$work/out" --dump-header "$work/headers" --write-out '%{http_code}' -X "$method"
    -H "authorization: Bearer $bearer")
  [[ -n "$body" ]] && args+=(-H 'content-type: application/json' -d "$body")
  status=$(curl "${args[@]}" "$MACRO_SDK_PROXY_URL/api$path")
  echo "--- $name: HTTP $status $(cat "$work/out")"
  if [[ "$status" == "$expected_status" ]] && grep -qF -- "$expected_text" "$work/out"; then
    echo "    PASS"
  else
    echo "    FAIL: expected $expected_status $expected_text"
    failures=$((failures + 1))
  fi
}

delete_run=$(register '["storage.delete_document"]')
expect_call "3b. a run that lists storage.delete_document, called directly" "$delete_run" \
  DELETE /storage/documents/doc-1 "" 403 '"code":"blocked"'
grep -qi '^x-macro-proxy: refused' "$work/headers" || {
  echo "    FAIL: the refusal has no x-macro-proxy header"
  failures=$((failures + 1))
}

search_run=$(register '["storage.task_similarity_search_handler"]')
expect_call "4a. a run token used for task creation, which the policy allows but the analysis did not list" \
  "$search_run" POST /storage/documents/create_task '{"taskName":"x"}' 403 '"code":"not_analyzed"'
expect_call "4b. the same run token for its listed operation" "$search_run" \
  POST /storage/documents/similarity_search '{"taskName":"x"}' 200 '"results":'
expect_call "4c. the execution token cannot call the proxy" "$token" \
  POST /storage/documents/similarity_search '{"taskName":"x"}' 401 '"code":"unauthorized"'

if ((failures > 0)); then
  echo "$failures check(s) failed"
  exit 1
fi
echo "all e2e checks passed"
