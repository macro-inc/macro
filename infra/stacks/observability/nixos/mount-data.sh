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
