#!/bin/bash
set -euo pipefail
device=$1
filesystem=$(blkid -s TYPE -o value "$device" || true)
if [ -z "$filesystem" ]; then
  # Fail closed if inspection fails, even when it produces no output.
  signatures=$(wipefs --no-act --noheadings --output TYPE "$device")
  test -z "$signatures"
  mkfs.ext4 "$device"
elif [ "$filesystem" != ext4 ]; then
  echo 'Refusing to format an existing data volume' >&2
  exit 1
fi
