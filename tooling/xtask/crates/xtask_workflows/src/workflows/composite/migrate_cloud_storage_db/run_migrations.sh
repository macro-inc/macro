echo "Running migrations for $MIGRATION_ENVIRONMENT environment..."
if [ "$MIGRATION_ENVIRONMENT" = "dev" ]; then
  cargo sqlx migrate run --ignore-missing
else
  cargo sqlx migrate run
fi
