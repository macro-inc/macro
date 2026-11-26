set -euo pipefail
export NIX_REMOTE=daemon
export PATH="/nix/var/nix/profiles/default/bin:$PATH"
sudo mkdir -p /var/cache/nix
sudo chown runner:runner /var/cache/nix
nix develop --profile /var/cache/nix/dev-shell --command true
