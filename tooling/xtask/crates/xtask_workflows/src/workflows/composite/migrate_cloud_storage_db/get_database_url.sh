if [ "$MIGRATION_ENVIRONMENT" = "prod" ]; then
  SECRET_NAME="macro-db-prod"
else
  SECRET_NAME="macro-db-dev"
fi

DATABASE_URL=$(aws secretsmanager get-secret-value \
  --secret-id "$SECRET_NAME" \
  --query SecretString \
  --output text)

# Ensure SSL is used for remote connections
if [[ "$DATABASE_URL" != *"sslmode="* ]]; then
  if [[ "$DATABASE_URL" == *"?"* ]]; then
    DATABASE_URL="${DATABASE_URL}&sslmode=require"
  else
    DATABASE_URL="${DATABASE_URL}?sslmode=require"
  fi
fi

echo "::add-mask::$DATABASE_URL"
echo "database_url=$DATABASE_URL" >> $GITHUB_OUTPUT
