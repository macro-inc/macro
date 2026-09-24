#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(\cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
\cd "$ROOT_DIR"

export DATABASE_URL="${DATABASE_URL:-postgres://user:password@localhost:5432/macrodb}"
unset SQLX_OFFLINE

raw_owner_writes="$(rg -n --glob '!**/test.rs' --glob '!**/tests.rs' \
  'insert_entity_access_row|insert_entity\(|INSERT INTO entity_access|INSERT INTO entity ' \
  crates/documents/src || true)"
if [[ -n "$raw_owner_writes" ]]; then
  echo "document owners must register through OwnedEntityRegistrar:" >&2
  echo "$raw_owner_writes" >&2
  exit 1
fi

python3 - <<'PY'
from pathlib import Path

path = Path("crates/projects/src/outbound/pg_project_repo/upload_folder.rs")
source = path.read_text()
document_create = source.split("async fn create_empty_document", 1)[1].split(
    "async fn create_document_share_permission", 1
)[0]
if "register_user_owned_document" not in document_create:
    raise SystemExit("folder-upload documents must use the owned entity registrar")
for forbidden in ("insert_entity_access_row", "insert_entity("):
    if forbidden in document_create:
        raise SystemExit(f"folder-upload documents contain raw owner write: {forbidden}")
PY

cargo test -p bot_id -p model_owner -p entity_registry --lib
cargo test -p activity --lib creation_principal
cargo test -p documents --lib
cargo test -p projects --lib pg_project_repo
cargo test --no-run -p ai_tools -p memory -p github -p document_storage_service \
  -p document_cognition_service -p mcp_service -p document_upload_finalizer_handler
