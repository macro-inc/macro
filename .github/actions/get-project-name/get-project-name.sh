#!/bin/bash
set -e

# Get project name from service name using services-config.json
# Usage: ./get-project-name.sh <service-name>

if [ -z "$1" ]; then
  echo "Error: service-name is required" >&2
  echo "Usage: $0 <service-name>" >&2
  exit 1
fi

SERVICE_NAME="$1"

STACK_PATH=$(jq -r --arg svc "$SERVICE_NAME" '.services[$svc].stack_path // "null"' .github/services-config.json)

if [ "$STACK_PATH" == "null" ]; then
  echo "Error: Service '$SERVICE_NAME' not found in services-config.json" >&2
  exit 1
fi

# Remove /** suffix if present
STACK_PATH_CLEAN="${STACK_PATH%/**}"
PROJECT_NAME=$(basename "$STACK_PATH_CLEAN")

echo "$PROJECT_NAME"
