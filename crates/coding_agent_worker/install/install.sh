#!/bin/sh
# Install macrod, Macro's agent daemon, on macOS or Linux:
#
#   curl -fsSL https://raw.githubusercontent.com/macro-inc/macro/main/crates/coding_agent_worker/install/install.sh | sh
#
# Run it again to update. MACROD_VERSION pins a release tag (v2026.10.18.0);
# MACROD_INSTALL_DIR overrides where the binary goes (~/.local/bin).

set -eu

repo="macro-inc/macro"
install_dir="${MACROD_INSTALL_DIR:-$HOME/.local/bin}"
version="${MACROD_VERSION:-latest}"

fail() {
  echo "macrod install: $*" >&2
  exit 1
}

command -v curl >/dev/null 2>&1 || fail "curl is required"

case "$(uname -s)" in
  Linux) os=linux ;;
  Darwin) os=macos ;;
  *) fail "unsupported OS $(uname -s); on Windows use install.ps1" ;;
esac

case "$(uname -m)" in
  x86_64 | amd64) arch=x86_64 ;;
  arm64 | aarch64) arch=aarch64 ;;
  *) fail "unsupported CPU $(uname -m)" ;;
esac
# A shell running under Rosetta reports x86_64 on Apple Silicon.
if [ "$os" = macos ] && [ "$arch" = x86_64 ] && [ "$(sysctl -n hw.optional.arm64 2>/dev/null || true)" = 1 ]; then
  arch=aarch64
fi

if [ "$version" = latest ]; then
  asset="macrod-$os-$arch.tar.gz"
  url="https://github.com/$repo/releases/latest/download/$asset"
else
  asset="macrod-$version-$os-$arch.tar.gz"
  url="https://github.com/$repo/releases/download/$version/$asset"
fi

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

echo "Downloading $url"
curl -fsSL --proto '=https' --tlsv1.2 -o "$work/$asset" "$url" ||
  fail "download failed; is $os-$arch published for $version?"
curl -fsSL --proto '=https' --tlsv1.2 -o "$work/$asset.sha256" "$url.sha256" ||
  fail "checksum download failed"

(
  cd "$work"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum -c "$asset.sha256" >/dev/null
  else
    shasum -a 256 -c "$asset.sha256" >/dev/null
  fi
) || fail "checksum mismatch for $asset"

tar -xzf "$work/$asset" -C "$work" macrod
mkdir -p "$install_dir"
# Rename into place: a running macrod keeps its old binary until it restarts.
install -m 755 "$work/macrod" "$install_dir/.macrod.new"
mv -f "$install_dir/.macrod.new" "$install_dir/macrod"

echo "Installed $("$install_dir/macrod" --version) to $install_dir/macrod"
case ":$PATH:" in
  *":$install_dir:"*) echo "Run: macrod" ;;
  *)
    echo "$install_dir is not on your PATH. Add it, e.g.:"
    echo "  echo 'export PATH=\"$install_dir:\$PATH\"' >> ~/.profile"
    echo "or run: $install_dir/macrod"
    ;;
esac
