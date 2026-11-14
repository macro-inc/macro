#!/usr/bin/env bash
# Fails unless every migration in ./migrations is applied, with the same
# checksum, to the database at DATABASE_URL. Applies nothing.
set -euo pipefail

# One line per migration: `<version>/<status> <description>`, where status is
# `installed`, `pending`, or `installed (different checksum)`.
migration_statuses=$(cargo sqlx migrate info)

if [[ -z "$migration_statuses" ]]; then
  echo "::error::Could not read migration status for $ENVIRONMENT."
  exit 1
fi

# Anything that is not a cleanly installed migration blocks, so an unexpected
# output format fails closed.
not_applied=$(grep -Ev '^[0-9]+/installed ([^(]|$)' <<< "$migration_statuses" || true)

if [[ -n "$not_applied" ]]; then
  echo "::error::This commit has migrations that are unapplied to $ENVIRONMENT, or that differ from what was applied. Apply them with the Migrate Macro Database workflow, or deploy a commit without them."
  echo "$not_applied"
  exit 1
fi

echo "Every migration in this commit is applied to $ENVIRONMENT."
