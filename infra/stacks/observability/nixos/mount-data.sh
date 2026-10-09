set -euo pipefail
volume_id=$(cat /opt/observability/volume-id)
device="/dev/disk/by-id/nvme-Amazon_Elastic_Block_Store_${volume_id//-/}"
for attempt in $(seq 1 120); do
  if [ -b "$device" ]; then break; fi
  sleep 5
done
test -b "$device"
bash /etc/observability/prepare-volume.sh "$device"
uuid=$(blkid -s UUID -o value "$device")
mkdir -p /srv/observability
mountpoint -q /srv/observability || mount -t ext4 "$device" /srv/observability
test "$(findmnt --noheadings --output UUID --target /srv/observability)" = "$uuid"
install -d -o 472 -g 472 /srv/observability/grafana
install -d -o 65534 -g 65534 /srv/observability/prometheus
install -d -o 10001 -g 10001 /srv/observability/{loki,tempo,alloy}
install -d -o root -g root -m 0700 /srv/observability/host-alloy
