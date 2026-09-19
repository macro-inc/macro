set -euo pipefail

# Package one built daemon binary as a release asset — and prove it is as
# self-contained as its platform allows before it ships. A binary that resolves
# a library at startup on the build runner and not on a user's machine is
# exactly the failure this whole pipeline exists to prevent, so it is checked
# here rather than assumed.

binary="target/$TARGET/release/macrod"
if [ ! -x "$binary" ]; then
  echo "no daemon binary at $binary" >&2
  exit 1
fi

case "$TARGET" in
  *-linux-musl)
    # Statically linked: nothing may be left to resolve at run time. `ldd`
    # exits non-zero with "not a dynamic executable" for a static binary, so
    # a successful ldd that names shared objects is the failure case.
    if ldd "$binary" 2>/dev/null | grep -q '=>'; then
      echo "expected a static binary, but $binary still links:" >&2
      ldd "$binary" >&2
      exit 1
    fi
    ;;
  *-apple-darwin)
    # macOS has no static libSystem, so "self-contained" means nothing from
    # outside the OS: a Homebrew or Nix-store path is one that will not exist
    # on the machine that downloads this.
    strays=$(otool -L "$binary" | tail -n +2 | awk '{ print $1 }' \
      | grep -Ev '^(/usr/lib/|/System/Library/)' || true)
    if [ -n "$strays" ]; then
      echo "daemon links libraries that will not exist on a user's Mac:" >&2
      echo "$strays" >&2
      exit 1
    fi
    ;;
  *)
    echo "no self-containment check defined for $TARGET" >&2
    exit 1
    ;;
esac

# It has to actually run, too — a binary that links cleanly and dies on its
# first instruction still ships broken. `--version` is the cheapest end-to-end
# proof, and the caller says whether this runner can execute this slice: the
# cross-built ones (aarch64 anywhere, x86_64 on an Apple Silicon runner) cannot.
if [ "$SMOKE_RUN" = "1" ]; then
  "$binary" --version
else
  echo "skipping smoke run: $TARGET does not execute on this runner"
fi

mkdir -p artifacts
name="macrod-${SAFE_TAG}-${SLUG}"
stage=$(mktemp -d)
install -m 755 "$binary" "$stage/macrod"
tar -czf "artifacts/${name}.tar.gz" -C "$stage" macrod
rm -rf "$stage"

# coreutils on Linux, BSD/perl on macOS.
(
  cd artifacts
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "${name}.tar.gz" >"${name}.tar.gz.sha256"
  else
    shasum -a 256 "${name}.tar.gz" >"${name}.tar.gz.sha256"
  fi
)

echo "packaged ${name}.tar.gz"
