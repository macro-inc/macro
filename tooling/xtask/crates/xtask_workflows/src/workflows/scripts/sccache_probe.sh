# Temporary: runs the real sccache against each backend mode, with the exported
# SCCACHE_CONF and without it. Never prints credentials.
set -uo pipefail
stub="$GITHUB_WORKSPACE/tooling/xtask/crates/xtask_workflows/src/workflows/scripts/sccache_probe_stub.py"
real_endpoint="$SCCACHE_WEBDAV_ENDPOINT"
real_base="$(python3 -c 'import sys,urllib.parse as u; p=u.urlsplit(sys.argv[1]); print(p.path)' "$real_endpoint")"
work="$RUNNER_TEMP/sccprobe"; mkdir -p "$work"
echo 'pub fn f() -> u32 { 7 }' > "$work/good.rs"
echo 'pub fn f() -> u32 { "x" }' > "$work/bad.rs"
echo "SCCPROBE conf=$SCCACHE_CONF contents=$(cat "$SCCACHE_CONF")"
port=19000
one() { # case mode arm run keep_token
  local case=$1 mode=$2 arm=$3 run=$4 stub_pid="" bp sp endpoint rc start end good="" bad="" msg
  port=$((port + 2)); bp=$port; sp=$((port + 1))
  if [ "$mode" != refused ]; then
    python3 "$stub" "$bp" "$mode" "$real_endpoint" >/dev/null 2>&1 &
    stub_pid=$!
    sleep 0.4
  fi
  endpoint="http://127.0.0.1:$bp/probe/"
  [ "${mode%%:*}" = proxy ] && endpoint="http://127.0.0.1:$bp$real_base"
  local envs=(SCCACHE_DIR="$work/d$sp" SCCACHE_SERVER_PORT="$sp" SCCACHE_WEBDAV_ENDPOINT="$endpoint")
  [ "$arm" = without ] && envs+=(SCCACHE_CONF=/dev/null)
  start=$(date +%s.%N)
  env "${envs[@]}" sccache --start-server > "$work/out$sp" 2>&1; rc=$?
  msg=$(grep -E 'error:|Listening' "$work/out$sp" | head -1 | cut -c1-90)
  end=$(date +%s.%N)
  if [ "$rc" = 0 ] && [ "${mode%%:*}" != proxy ]; then
    (cd "$work"; env "${envs[@]}" sccache rustc --crate-type rlib --edition 2021 -o "g$sp.rlib" good.rs >/dev/null 2>&1; echo $? > "g$sp"; env "${envs[@]}" sccache rustc --crate-type rlib --edition 2021 -o "b$sp.rlib" bad.rs >/dev/null 2>&1; echo $? > "b$sp")
    good=$(cat "$work/g$sp"); bad=$(cat "$work/b$sp")
  fi
  env "${envs[@]}" sccache --stop-server >/dev/null 2>&1
  [ -n "$stub_pid" ] && kill "$stub_pid" 2>/dev/null
  printf 'SCCPROBE case=%s arm=%s run=%s server_up=%s secs=%.1f good_rc=%s bad_rc=%s msg=%s\n' "$case" "$arm" "$run" "$([ "$rc" = 0 ] && echo yes || echo no)" "$(echo "$end $start" | awk '{print $1-$2}')" "$good" "$bad" "$msg"
}
for run in 1 2 3 4 5; do
  for arm in without with; do
    one healthy slow:0 "$arm" "$run"
    one slow_12s slow:4 "$arm" "$run"
    one slow_30s slow:10 "$arm" "$run"
    one real_backend_delay_12s proxy:4 "$arm" "$run"
    one backend_401 status:401 "$arm" "$run"
    one backend_500 status:500 "$arm" "$run"
    one refused refused "$arm" "$run"
    one hang hang "$arm" "$run"
  done
done
