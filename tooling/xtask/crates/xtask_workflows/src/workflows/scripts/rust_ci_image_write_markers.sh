set -euo pipefail
marker="run_id=${BUILD_RUN_ID} sha=${BUILD_SHA} ts=$(date -u +%FT%TZ)"
# Write to multiple locations to learn which the snapshot preserves.
echo "$marker" | sudo tee /opt/macro-ami-marker.txt >/dev/null
echo "$marker" | sudo tee /etc/macro-ami-marker.txt >/dev/null
echo "$marker" | sudo tee /usr/local/share/macro-ami-marker.txt >/dev/null
echo "$marker" > /home/runner/macro-ami-marker.txt
# Also drop a sentinel inside /nix so we can tell if the whole tree was wiped.
echo "$marker" | sudo tee /nix/macro-ami-marker.txt >/dev/null
