#!/usr/bin/env bash
# Run as root inside a disposable macro-box guest. JSON is the last stdout line.
# Modes: before, after, hibernate-before, hibernate-after, big-build, browsers.
# Browser modes require browser-checks.mjs and mcp-checks.py alongside this file.
set -uo pipefail
mode=${1:-before}
if ! mountpoint -q /home; then
  printf '{"mode":"%s","ok":false,"error":"Home volume is not mounted"}\n' "$mode"
  exit 1
fi
here=$(\cd "$(dirname "$0")" && pwd)
state=/home/macro/.macro-guest-checks
logs=$state/logs
mkdir -p "$logs"
chown -R macro: "$state"
results=()
failed=0
as_macro() { timeout 1800 runuser -l macro -c "set -euo pipefail; export XDG_RUNTIME_DIR=/run/user/1000; export DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus; export E2E_STATE='$state'; $1"; }
check() {
  local name=$1 cmd start end rc seconds
  # Keep the script literal until macro's login shell expands it.
  cmd=$(cat) || exit 1
  start=$(date +%s.%N)
  as_macro "$cmd" > "$logs/$mode-$name.log" 2>&1
  rc=$?
  end=$(date +%s.%N)
  seconds=$(awk -v a="$start" -v b="$end" 'BEGIN { printf "%.3f", b-a }')
  local ok=true
  if [ "$rc" -ne 0 ]; then ok=false; failed=1; fi
  results+=("\"$name\":{\"ok\":$ok,\"s\":$seconds,\"exit_code\":$rc}")
  echo "$name: $ok (${seconds}s), log: $logs/$mode-$name.log" >&2
}
case $mode in
before)
  check environment <<'GUEST_COMMAND'
nix --version; nix flake metadata --json nixpkgs; uname -a; lscpu; free -k; lsblk -o NAME,SIZE,TYPE,MOUNTPOINTS
GUEST_COMMAND
  check home_block_device <<'GUEST_COMMAND'
findmnt -T "$HOME" -n -o SOURCE,FSTYPE | tee "$E2E_STATE/home-mount"; device=$(findmnt -T "$HOME" -n -o SOURCE); test -b "${device%%\[*}"; test "$(findmnt -T "$HOME" -n -o TARGET)" = /home
GUEST_COMMAND
  check home_write <<'GUEST_COMMAND'
cat /proc/sys/kernel/random/uuid > "$E2E_STATE/sentinel"; sha256sum "$E2E_STATE/sentinel" > "$E2E_STATE/sentinel.sha256"; sync
GUEST_COMMAND
  check nix_profile_install <<'GUEST_COMMAND'
nix profile install nixpkgs#ripgrep; command -v rg > "$E2E_STATE/rg-path"; rg --version > "$E2E_STATE/rg-version"
GUEST_COMMAND
  check cargo_build <<'GUEST_COMMAND'
mkdir -p "$E2E_STATE/cargo/src"; printf "[package]\nname=\"guest-e2e\"\nversion=\"0.1.0\"\nedition=\"2021\"\n[dependencies]\nserde_json=\"=1.0.145\"\n" > "$E2E_STATE/cargo/Cargo.toml"; printf 'fn main() { let v: serde_json::Value = serde_json::from_str(r#"{"ok":true}"#).unwrap(); assert_eq!(v["ok"], true); println!("cargo-e2e-ok"); }\n' > "$E2E_STATE/cargo/src/main.rs"; cd "$E2E_STATE/cargo"; nix shell nixpkgs#cargo nixpkgs#rustc nixpkgs#gcc -c sh -ec "cargo build -j 4; ./target/debug/guest-e2e"
GUEST_COMMAND
  check docker_pull_run <<'GUEST_COMMAND'
docker pull docker.io/library/hello-world:latest; docker run --rm docker.io/library/hello-world:latest
GUEST_COMMAND
  check docker_build <<'GUEST_COMMAND'
mkdir -p "$E2E_STATE/docker"; printf "FROM docker.io/library/busybox:1.37.0\nRUN echo docker-build-ok > /proof\nCMD [\"cat\", \"/proof\"]\n" > "$E2E_STATE/docker/Dockerfile"; docker build -t macro-guest-e2e:local "$E2E_STATE/docker"; test "$(docker run --rm macro-guest-e2e:local)" = docker-build-ok
GUEST_COMMAND
  ;;
after|hibernate-after)
  check home_survives <<'GUEST_COMMAND'
sha256sum --check "$E2E_STATE/sentinel.sha256"
GUEST_COMMAND
  check package_survives <<'GUEST_COMMAND'
test "$(command -v rg)" = "$(cat "$E2E_STATE/rg-path")"; rg --version | cmp - "$E2E_STATE/rg-version"
GUEST_COMMAND
  check cargo_survives <<'GUEST_COMMAND'
test "$("$E2E_STATE/cargo/target/debug/guest-e2e")" = cargo-e2e-ok
GUEST_COMMAND
  check docker_survives <<'GUEST_COMMAND'
test "$(docker run --rm macro-guest-e2e:local)" = docker-build-ok
GUEST_COMMAND
  if [ "$mode" = hibernate-after ]; then
    check browser_survives <<'GUEST_COMMAND'
cd "$E2E_STATE/browser"; node browser-checks.mjs restore
GUEST_COMMAND
  fi
  ;;
big-build)
  # A source build, not a large binary-cache download. The fresh store path
  # supplied by --rebuild is built again on every backend; dependencies may substitute.
  check nix_build_prepare <<'GUEST_COMMAND'
nix build --no-link --max-jobs 1 --cores 4 nixpkgs#git
GUEST_COMMAND
  check nix_source_build <<'GUEST_COMMAND'
for dir in /nix/store /tmp; do findmnt -T "$dir" -n -o SOURCE,FSTYPE; device=$(findmnt -T "$dir" -n -o SOURCE); test -b "${device%%\[*}"; done; nix build --no-link --rebuild --max-jobs 1 --cores 4 nixpkgs#git
GUEST_COMMAND
  ;;
browsers|hibernate-before)
  if [ "$mode" = browsers ]; then
    install -m 644 -o macro -g macro "$here/mcp-checks.py" "$state/mcp-checks.py"
    check mcp_browser <<'GUEST_COMMAND'
python3 "$E2E_STATE/mcp-checks.py" --log-dir "$E2E_STATE/logs"
GUEST_COMMAND
  fi
  install -m 644 -o macro -g macro "$here/browser-checks.mjs" "$state/browser-checks.mjs"
  check browser_setup <<'GUEST_COMMAND'
mkdir -p "$E2E_STATE/browser"; cp "$E2E_STATE/browser-checks.mjs" "$E2E_STATE/browser/"; cd "$E2E_STATE/browser"; npm install --no-audit --no-fund --save-exact playwright-core@1.56.1
GUEST_COMMAND
  if [ "$mode" = browsers ]; then
    check browsers <<'GUEST_COMMAND'
cd "$E2E_STATE/browser"; E2E_MESA=$(nix build --no-link --print-out-paths nixpkgs#mesa); export E2E_MESA; nix shell nixpkgs#firefox nixpkgs#geckodriver -c node browser-checks.mjs measure
GUEST_COMMAND
  else
    check browser_prepare <<'GUEST_COMMAND'
cd "$E2E_STATE/browser"; node browser-checks.mjs prepare; node browser-checks.mjs restore
GUEST_COMMAND
  fi
  ;;
*) echo "unknown mode: $mode" >&2; exit 2 ;;
esac
if [ "$mode" = browsers ] || [ "$mode" = hibernate-before ] || [ "$mode" = hibernate-after ]; then
  browser_log=$logs/$mode-browsers.log
  [ "$mode" != hibernate-before ] || browser_log=$logs/$mode-browser_prepare.log
  [ "$mode" != hibernate-after ] || browser_log=$logs/$mode-browser_survives.log
  if [ -f "$browser_log" ]; then
    metrics=$(jq -Rrc 'fromjson? | select(type == "object" and has("checks"))' "$browser_log" | tail -n 1)
    if jq -e 'type == "object" and has("checks")' <<< "$metrics" >/dev/null 2>&1; then
      results+=("\"browser_metrics\":$metrics")
    fi
  fi
fi
ok=true
[ "$failed" -eq 0 ] || ok=false
(IFS=,; printf '{"mode":"%s","ok":%s,"checks":{%s}}\n' "$mode" "$ok" "${results[*]}")
exit "$failed"
