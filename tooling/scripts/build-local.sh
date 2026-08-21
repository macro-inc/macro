#!/bin/bash
set -euo pipefail

# Build a Linux service image with Nix dockerTools and push it to ECR.
#
# Usage: tooling/scripts/build-local.sh <service-key> <ECR_REPO>
# Example: tooling/scripts/build-local.sh authentication-service 569036502058.dkr.ecr.us-east-1.amazonaws.com/authentication-service-dev

SERVICE_NAME=${1:-}
ECR_REPO=${2:-}
IMAGE_TAG="local"

if [ -z "$SERVICE_NAME" ] || [ -z "$ECR_REPO" ]; then
  echo "Usage: $0 <service-key> <ECR_REPO>"
  echo "  service-key is the flake docker-image-* suffix, e.g. authentication-service"
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

echo "Building docker-image-${SERVICE_NAME} with Nix dockerTools..."
nix build --print-build-logs ".#docker-image-${SERVICE_NAME}"
load_out=$(docker load -i result)
loaded=$(printf '%s\n' "$load_out" | awk '/Loaded image:/{print $3; exit}')
if [[ -z "$loaded" ]]; then
  loaded=$(printf '%s\n' "$load_out" | awk '/Loaded image ID:/{print $4; exit}')
fi
if [[ -z "$loaded" ]]; then
  echo "error: could not parse docker load output:" >&2
  printf '%s\n' "$load_out" >&2
  exit 1
fi

docker tag "$loaded" "$ECR_REPO:$IMAGE_TAG"
docker push "$ECR_REPO:$IMAGE_TAG"
echo "✅ Built and pushed $ECR_REPO:$IMAGE_TAG"
