# Best-effort: never fail the job from teardown.
set +e
for unit in \
  nix-daemon.service nix-daemon.socket \
  determinate-nixd.service determinate-nixd.socket; do
  sudo systemctl stop "$unit" 2>/dev/null
done
# Non-systemd runners (e.g. Namespace): the daemon was started
# directly by setup-nix; stop it the same way.
sudo pkill -x nix-daemon 2>/dev/null
sudo pkill -x determinate-nixd 2>/dev/null
# Backstop: free any remaining handles so the umount can succeed.
sudo fuser -km /nix 2>/dev/null
sync
exit 0
