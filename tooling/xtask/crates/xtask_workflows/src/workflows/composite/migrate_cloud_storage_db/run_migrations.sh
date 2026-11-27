echo "Running migrations for $MIGRATION_ENVIRONMENT environment..."
# `sqlx`, not `cargo sqlx`: the db-migrator runner has no cargo.
if [ "$MIGRATION_ENVIRONMENT" = "dev" ]; then
  sqlx migrate run --ignore-missing
else
  sqlx migrate run
fi
