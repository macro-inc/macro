#!/bin/bash

# Initialize local development database with user for AI chat
# Usage: ./init-local-dcs.sh [user_id]
# If no user_id provided, uses LOCAL_USER_ID from environment

USER_ID="${1:-$LOCAL_USER_ID}"

if [ -z "$USER_ID" ]; then
    echo "Error: No user ID provided and LOCAL_USER_ID not set in environment"
    echo "Usage: $0 [user_id] or set LOCAL_USER_ID environment variable"
    exit 1
fi

# Extract email from user ID (format: macro|email@domain.com)
EMAIL="${USER_ID#macro|}"
STRIPE_ID="cus_LOCAL_DEV_$(echo $EMAIL | tr '[:lower:]' '[:upper:]' | tr -d '@.-')"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

echo "Setting up local development database for document-cognition-service..."
echo "User ID: $USER_ID"
echo "Email: $EMAIL"

# Run base database initialization first
echo "Running base database initialization..."
(cd "$REPO_ROOT" && just initialize_dbs)

# Create SQL file from template with substitutions
echo "Creating user SQL file..."
sed -e "s/USER_ID_PLACEHOLDER/$USER_ID/g" \
    -e "s/EMAIL_PLACEHOLDER/$EMAIL/g" \
    -e "s/STRIPE_ID_PLACEHOLDER/$STRIPE_ID/g" \
    "$SCRIPT_DIR/init-local-user.sql" > "$SCRIPT_DIR/InitiateLocalUser.sql"

# Add the local development user
echo "Adding local development user..."
docker compose -f "$REPO_ROOT/docker/docker-compose-databases.yml" exec -T postgres \
    psql -U user -d macrodb -v ON_ERROR_STOP=1 \
    < "$SCRIPT_DIR/InitiateLocalUser.sql"

# Cleanup
rm "$SCRIPT_DIR/InitiateLocalUser.sql"

echo "Local development database initialized successfully!"
echo "User '$USER_ID' has been added with AI chat capabilities."
