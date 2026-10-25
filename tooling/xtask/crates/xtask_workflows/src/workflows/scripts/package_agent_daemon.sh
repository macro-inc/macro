set -euo pipefail

# Package one built daemon binary as a release asset — and prove it is as
# self-contained as its platform allows before it ships. A binary that resolves
# a library at startup on the build runner and not on a user's machine is
# exactly the failure this whole pipeline exists to prevent, so it is checked
# here rather than assumed.

case "$TARGET" in
  *-windows-*) executable="macrod.exe" ;;
  *) executable="macrod" ;;
esac
binary="target/$TARGET/release/$executable"
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
  *-windows-msvc)
    # Every DLL must come from Windows itself. Git Bash's ldd resolves the
    # imports; one found outside C:\Windows (a vcruntime, a build-tool DLL)
    # will not be on a user's machine.
    imports=$(ldd "$binary")
    strays=$(printf '%s\n' "$imports" | awk '$2 == "=>" { print $3 }' \
      | grep -Eiv '^(/c/windows/|\?\?\?$)' || true)
    if [ -n "$strays" ]; then
      echo "daemon links DLLs that will not exist on a user's PC:" >&2
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
stage=$(mktemp -d)
install -m 755 "$binary" "$stage/$executable"

# Every archive is published twice: under the tag, and under a name without
# it, which `releases/latest/download/<name>` serves — the URL the install
# scripts download from.
for name in "macrod-${SAFE_TAG}-${SLUG}" "macrod-${SLUG}"; do
  case "$TARGET" in
    *-windows-*)
      archive="${name}.zip"
      powershell.exe -NoProfile -NonInteractive -Command \
        "Compress-Archive -Path '$(cygpath -w "$stage/$executable")' -DestinationPath '$(cygpath -w "artifacts/$archive")'"
      ;;
    *)
      archive="${name}.tar.gz"
      tar -czf "artifacts/$archive" -C "$stage" "$executable"
      ;;
  esac

  # coreutils on Linux and Git Bash, BSD/perl on macOS.
  (
    cd artifacts
    if command -v sha256sum >/dev/null 2>&1; then
      sha256sum "$archive" >"$archive.sha256"
    else
      shasum -a 256 "$archive" >"$archive.sha256"
    fi
  )
  echo "packaged $archive"
done
rm -rf "$stage"
