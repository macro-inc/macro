set -euo pipefail
curl --http1.1 --retry 5 --retry-delay 5 --retry-all-errors \
  --proto '=https' --tlsv1.2 -sSf -L https://install.determinate.systems/nix | \
  sh -s -- install linux --no-confirm --init systemd \
  --extra-conf "experimental-features = nix-command flakes" \
  --extra-conf "trusted-users = root runner"
# Daemon socket may be active but not reachable in this shell; ensure it.
sudo systemctl enable --now nix-daemon.socket nix-daemon.service
# Make nix discoverable in non-login shells (GHA default).
echo 'PATH="/nix/var/nix/profiles/default/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"' \
  | sudo tee /etc/environment >/dev/null
