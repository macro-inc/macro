#!/usr/bin/env bash
set -euo pipefail

INSTANCE_ID="macro-db-prod"
PG_FAMILY="postgres14"
PARAM_GROUP_NAME="macro-db-prod-custom"

echo "=== Creating custom parameter group ==="
aws rds create-db-parameter-group \
  --db-parameter-group-name "$PARAM_GROUP_NAME" \
  --db-parameter-group-family "$PG_FAMILY" \
  --description "Custom parameter group for macro-db-prod (checkpoint/WAL/vacuum tuning)"

echo "=== Setting parameters ==="
aws rds modify-db-parameter-group \
  --db-parameter-group-name "$PARAM_GROUP_NAME" \
  --parameters \
    "ParameterName=checkpoint_timeout,ParameterValue=900,ApplyMethod=immediate" \
    "ParameterName=max_wal_size,ParameterValue=16384,ApplyMethod=immediate" \
    "ParameterName=min_wal_size,ParameterValue=4096,ApplyMethod=immediate" \
    "ParameterName=vacuum_cost_page_miss,ParameterValue=10,ApplyMethod=immediate"

echo "=== Applying parameter group to $INSTANCE_ID ==="
aws rds modify-db-instance \
  --db-instance-identifier "$INSTANCE_ID" \
  --db-parameter-group-name "$PARAM_GROUP_NAME" \
  --apply-immediately

echo "=== Done ==="
echo "Parameter group applied. Dynamic params take effect within minutes."
echo "Run 'aws rds describe-db-instances --db-instance-identifier $INSTANCE_ID --query DBInstances[0].DBParameterGroups' to check status."
