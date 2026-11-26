set -euo pipefail

# Namespace runners do not always include Rust; rustup installs into
# ~/.cargo/bin, which also needs to be visible to later steps.
export PATH="$HOME/.cargo/bin:$PATH"
echo "$HOME/.cargo/bin" >> "$GITHUB_PATH"

if ! command -v rustup >/dev/null 2>&1; then
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal
fi

if [[ -f rust-toolchain.toml ]]; then
  toolchain="$(grep -E '^[[:space:]]*channel[[:space:]]*=' rust-toolchain.toml | sed -E 's/.*"([^"]+)".*/\1/')"
else
  toolchain="stable"
fi

if ! rustup run "$toolchain" rustc --version >/dev/null 2>&1; then
  rustup toolchain install "$toolchain" --profile minimal --component clippy --component rustfmt
else
  echo "Rust toolchain $toolchain already installed: $(rustup run "$toolchain" rustc --version)"
  installed_components="$(rustup component list --toolchain "$toolchain" --installed)"
  if ! grep -q '^clippy-' <<<"$installed_components"; then
    rustup component add --toolchain "$toolchain" clippy
  fi
  if ! grep -q '^rustfmt-' <<<"$installed_components"; then
    rustup component add --toolchain "$toolchain" rustfmt
  fi
fi

rustup default "$toolchain"
