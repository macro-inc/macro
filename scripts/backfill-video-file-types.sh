#!/bin/bash
set -euo pipefail

DRY_RUN="${DRY_RUN:-false}"

if [ "$DRY_RUN" = "true" ]; then
  echo "=== DRY RUN MODE ==="
fi

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL is required"
  exit 1
fi

if [ -z "${S3_BUCKET:-}" ]; then
  echo "S3_BUCKET is required"
  exit 1
fi

VIDEO_EXTENSIONS="mov|mkv|webm|avi|wmv|mpg|mpeg|m4v|flv|f4v|3gp"

echo "=== Finding documents with null fileType and video extensions ==="

ROWS=$(psql "$DATABASE_URL" -t -A -F $'\t' -c "
  SELECT d.id, d.name, d.owner, di.id as version_id
  FROM \"Document\" d
  JOIN \"DocumentInstance\" di ON di.\"documentId\" = d.id
  WHERE d.\"fileType\" IS NULL
    AND d.name ~* '\.($VIDEO_EXTENSIONS)$'
")

if [ -z "$ROWS" ]; then
  echo "No documents to backfill."
  exit 0
fi

echo "$ROWS" | while IFS=$'\t' read -r doc_id name owner version_id; do
  extension=$(echo "$name" | grep -oiE "\.($VIDEO_EXTENSIONS)$" | tr '[:upper:]' '[:lower:]' | sed 's/^\.//')
  clean_name=$(echo "$name" | sed -E "s/\.($VIDEO_EXTENSIONS)$//i")
  old_key="${owner}/${doc_id}/${version_id}"
  new_key="${owner}/${doc_id}/${version_id}.${extension}"

  echo ""
  echo "--- Processing: $name (${doc_id}) ---"
  echo "  extension: $extension"
  echo "  old key:   $old_key"
  echo "  new key:   $new_key"

  if [ "$DRY_RUN" = "true" ]; then
    echo "  clean name: $clean_name"
    echo "  [dry run] would copy S3 key and update DB"
    continue
  fi

  # Check if extensionless key exists
  if aws s3api head-object --bucket "$S3_BUCKET" --key "$old_key" > /dev/null 2>&1; then
    echo "  S3: copying $old_key -> $new_key"
    aws s3api copy-object \
      --bucket "$S3_BUCKET" \
      --copy-source "${S3_BUCKET}/${old_key}" \
      --key "$new_key" > /dev/null
    echo "  S3: copy complete"
  elif aws s3api head-object --bucket "$S3_BUCKET" --key "$new_key" > /dev/null 2>&1; then
    echo "  S3: $new_key already exists, skipping copy"
  else
    echo "  S3: WARNING - neither key exists, skipping"
    continue
  fi

  echo "  DB: updating fileType='$extension', name='$clean_name'"
  psql "$DATABASE_URL" -c "
    UPDATE \"Document\"
    SET \"fileType\" = '$extension',
        \"name\" = '$clean_name'
    WHERE id = '$doc_id'
      AND \"fileType\" IS NULL;
  " > /dev/null

  echo "  Done."
done

echo ""
echo "=== Backfill complete ==="
