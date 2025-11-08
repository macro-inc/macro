#!/usr/bin/env bash
# This script is used to get the database url for any rds database
# The output can be set as the DATABASE_URL environment variable

# Validate that both arguments exist
if [ -z "$1" ] || [ -z "$2" ] || [ -z "$3" ]; then
    echo "Error: Missing required arguments."
    echo "Usage: $0 <rds_identifier> <secret_name> <db_name>"
    exit 1
fi

RDS_IDENTIFIER=$1
SECRET_NAME=$2
DATABASE_NAME=$3

DB_PASSWORD=$(aws secretsmanager get-secret-value --secret-id $SECRET_NAME --query SecretString --output text)

ENDPOINT=$(aws rds describe-db-instances --db-instance-identifier $RDS_IDENTIFIER --query 'DBInstances[0].Endpoint.Address' --output text)

DATABASE_URL="postgres://macrouser:$DB_PASSWORD@$ENDPOINT:5432/$DATABASE_NAME"

echo "$DATABASE_URL"
