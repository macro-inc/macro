set -euo pipefail
if ! command -v nix >/dev/null 2>&1; then
  curl --http1.1 --retry 5 --retry-delay 5 --retry-all-errors \
    --proto '=https' --tlsv1.2 -sSf -L https://install.determinate.systems/nix | \
    sh -s -- install macos --no-confirm \
    --extra-conf "experimental-features = nix-command flakes" \
    --extra-conf "sandbox = false" \
    --extra-conf "trusted-users = root runner"
fi
echo "/nix/var/nix/profiles/default/bin" >> "$GITHUB_PATH"
echo "NIX_REMOTE=daemon" >> "$GITHUB_ENV"
export PATH="/nix/var/nix/profiles/default/bin:$PATH"
export NIX_REMOTE=daemon
nix --version
