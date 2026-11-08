#!/usr/bin/env bash
# install.sh in fresh homes, one per login shell: macrod must resolve in a new
# shell, a second run must not add the PATH line again, and --no-modify-path
# must leave startup files alone. Installs from a directory mirror.
#
#   installer_test.sh RELEASES_DIR TAG   (INSTALLER_TEST_SHELLS="bash zsh" to pick)
set -euo pipefail

releases=$(cd "$1" && pwd)
tag=$2
here=$(cd "$(dirname "$0")" && pwd)
installer="$here/../install/install.sh"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

mirror="$work/mirror"
mkdir -p "$mirror"
cp "$releases"/macrod-"$tag"-* "$mirror/"
printf '{"tag_name": "%s", "assets": []}\n' "$tag" >"$mirror/latest.json"

marker="# Added by the macrod installer"
# The caller's PATH, which must not already contain the install folder.
base_path=$PATH
failures=0
fail() {
  echo "FAIL: $*" >&2
  failures=$((failures + 1))
}

# Run the installer as a user of $1 with a fresh home; prints the home.
install_for() {
  local shell=$1
  shift
  local home="$work/home-$shell-$RANDOM"
  mkdir -p "$home"
  env -i HOME="$home" PATH="$base_path" SHELL="/bin/$shell" \
    MACROD_UPDATE_SOURCE="$mirror" MACROD_NO_MODIFY_PATH="${MACROD_NO_MODIFY_PATH:-}" \
    sh "$installer" "$@" >"$home.log" 2>&1 ||
    { cat "$home.log" >&2; fail "$shell: install.sh failed"; }
  echo "$home"
}

# What `macrod` resolves to in a new interactive shell of that kind.
resolve_in_new_shell() {
  local shell=$1 home=$2
  case "$shell" in
    bash) env -i HOME="$home" PATH="$base_path" TERM=dumb "$(command -v bash)" -ic 'command -v macrod' 2>/dev/null ;;
    # A login shell too: macOS Terminal starts those.
    bash-login) env -i HOME="$home" PATH="$base_path" TERM=dumb "$(command -v bash)" -lc 'command -v macrod' 2>/dev/null ;;
    zsh) env -i HOME="$home" PATH="$base_path" TERM=dumb "$(command -v zsh)" -ic 'command -v macrod' 2>/dev/null ;;
    fish) env -i HOME="$home" PATH="$base_path" TERM=dumb "$(command -v fish)" -c 'command -v macrod' 2>/dev/null ;;
  esac
}

# Every line of every startup file the installer may touch.
startup_lines() {
  { cat "$1"/.bashrc "$1"/.bash_profile "$1"/.zshrc "$1"/.config/fish/conf.d/macrod.fish 2>/dev/null || true; } | wc -l | tr -d ' '
}

for shell in ${INSTALLER_TEST_SHELLS:-bash zsh fish}; do
  if ! command -v "$shell" >/dev/null 2>&1; then
    fail "$shell is not installed here"
    continue
  fi
  home=$(install_for "$shell")
  expected="$home/.local/bin/macrod"
  resolved=$(resolve_in_new_shell "$shell" "$home" || true)
  [ "$resolved" = "$expected" ] || fail "$shell: a new shell resolves macrod to '$resolved', not $expected"
  if [ "$shell" = bash ] && [ "$(uname -s)" = Darwin ]; then
    resolved=$(resolve_in_new_shell bash-login "$home" || true)
    [ "$resolved" = "$expected" ] || fail "bash login: resolves macrod to '$resolved'"
  fi
  [ "$("$expected" --version)" = "macrod $tag" ] || fail "$shell: wrong version installed"

  # A second run (an update by hand) changes nothing.
  before=$(startup_lines "$home")
  env -i HOME="$home" PATH="$base_path" SHELL="/bin/$shell" MACROD_UPDATE_SOURCE="$mirror" sh "$installer" >"$home.second.log" 2>&1 ||
    fail "$shell: second install failed"
  after=$(startup_lines "$home")
  [ "$before" = "$after" ] || fail "$shell: the second run changed startup files ($before -> $after lines)"
  count=$({ cat "$home"/.bashrc "$home"/.zshrc "$home"/.config/fish/conf.d/macrod.fish 2>/dev/null || true; } | grep -cF "$marker" || true)
  [ "$count" = 1 ] || fail "$shell: $count PATH entries in the primary startup file"
  grep -q "already adds" "$home.second.log" || fail "$shell: the second run did not say it changed nothing"
  echo "ok $shell: $(grep -h '^Added' "$home.log" | tr '\n' ' ')"
done

home=$(install_for bash --no-modify-path)
[ ! -e "$home/.bashrc" ] || fail "--no-modify-path wrote $home/.bashrc"
home=$(MACROD_NO_MODIFY_PATH=1 install_for zsh)
[ ! -e "$home/.zshrc" ] || fail "MACROD_NO_MODIFY_PATH wrote $home/.zshrc"
echo "ok --no-modify-path"

if [ "$failures" -gt 0 ]; then
  echo "$failures installer check(s) failed" >&2
  exit 1
fi
echo "all installer checks passed"
