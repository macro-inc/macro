#!/bin/bash
set -u

export S3_BUCKET="${S3_BUCKET:?S3_BUCKET is required}"

attempt=0
while true; do
  attempt=$((attempt + 1))
  echo "=== Attempt $attempt ($(date)) ==="
  bun run migrate
  exit_code=$?

  if [ $exit_code -eq 0 ]; then
    # Check if cursor was cleared (migration complete)
    cursor_file="cursor-${S3_BUCKET}.txt"
    if [ ! -f "$cursor_file" ] || [ ! -s "$cursor_file" ]; then
      echo "=== Migration complete after $attempt attempts ==="
      break
    fi
    echo "Exited cleanly but cursor still set, resuming..."
  else
    echo "Exited with code $exit_code, resuming from cursor..."
  fi

  sleep 1
done
