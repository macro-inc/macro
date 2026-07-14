#!/usr/bin/env bash
set -euo pipefail

ENV="${1:-}"
if [[ "$ENV" != "dev" && "$ENV" != "prod" ]]; then
  echo "Usage: $0 <dev|prod>"
  exit 1
fi

if [[ "$ENV" == "prod" ]]; then
  INSTANCE_ID="macro-db-prod"
  PG_FAMILY="postgres14"
else
  INSTANCE_ID="macro-db-dev"
  PG_FAMILY="postgres16"
fi

PARAM_GROUP_NAME="${INSTANCE_ID}-custom"

echo "=== [$ENV] Creating custom parameter group: $PARAM_GROUP_NAME ($PG_FAMILY) ==="
aws rds create-db-parameter-group \
  --db-parameter-group-name "$PARAM_GROUP_NAME" \
  --db-parameter-group-family "$PG_FAMILY" \
  --description "Custom parameter group for $INSTANCE_ID (checkpoint/WAL/vacuum tuning)"

echo "=== [$ENV] Setting parameters ==="
aws rds modify-db-parameter-group \
  --db-parameter-group-name "$PARAM_GROUP_NAME" \
  --parameters \
    "ParameterName=checkpoint_timeout,ParameterValue=900,ApplyMethod=immediate" \
    "ParameterName=max_wal_size,ParameterValue=16384,ApplyMethod=immediate" \
    "ParameterName=min_wal_size,ParameterValue=4096,ApplyMethod=immediate" \
    "ParameterName=vacuum_cost_page_miss,ParameterValue=10,ApplyMethod=immediate"

echo "=== [$ENV] Applying parameter group to $INSTANCE_ID ==="
aws rds modify-db-instance \
  --db-instance-identifier "$INSTANCE_ID" \
  --db-parameter-group-name "$PARAM_GROUP_NAME" \
  --apply-immediately

echo "=== [$ENV] Done ==="
echo "Parameter group applied. Dynamic params take effect within minutes."
echo "Run 'aws rds describe-db-instances --db-instance-identifier $INSTANCE_ID --query DBInstances[0].DBParameterGroups' to check status."
